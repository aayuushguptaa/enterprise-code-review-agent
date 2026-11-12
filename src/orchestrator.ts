import {
  query,
  type Options,
  type SDKMessage,
  type SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs';
import * as path from 'path';

import { reviewAgents } from './agents/index.js';
import { buildMcpServersConfig, MCP_ALLOWED_TOOLS } from './config/mcp.config.js';
import { ORCHESTRATOR_SYSTEM_PROMPT, buildOrchestratorPrompt } from './prompts/index.js';
import {
  ReviewReportSchema,
  ReviewReportJSONSchema,
  type ReviewReport
} from './types/index.js';
import { ErrorCodes, ReviewError, withRetry } from './utils/error-handler.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError,
  logAgentStart
} from './utils/logger.js';
import { RateLimiter, type RateLimiterConfig } from './utils/rate-limiter.js';
import { SubagentCollector, type FileReview } from './utils/subagent-collector.js';

type QueryFn = typeof query;

export interface OrchestratorOptions {
  /** Model id, e.g. claude-sonnet-4-5-20250929 */
  model?: string;
  /** Directory that contains .claude/skills (defaults to PROJECT_ROOT or cwd) */
  projectRoot?: string;
  /** Wall-clock limit for one review attempt */
  timeoutMs?: number;
  /** Total attempts for one review (see withRetry) */
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Token estimate used for rate limiting before the real usage is known */
  estimatedTokens?: number;
  /** Safety caps for a single run */
  maxTurns?: number;
  maxBudgetUsd?: number;
  rateLimits?: Partial<RateLimiterConfig>;
  /** Injectable for tests; defaults to the SDK's query() */
  queryFn?: QueryFn;
}

const DEFAULTS = {
  model: 'claude-sonnet-4-5-20250929',
  timeoutMs: 10 * 60_000,
  maxAttempts: 2,
  retryDelayMs: 1_000,
  estimatedTokens: 20_000,
  maxTurns: 40
} as const;

/** Errors that will not get better by trying again. */
const NON_RETRYABLE: ReadonlySet<string> = new Set([
  ErrorCodes.INVALID_CONFIG,
  ErrorCodes.MISSING_API_KEY,
  ErrorCodes.AGENT_TIMEOUT
]);

/**
 * Recomputes the report summary from the per-file results.
 * The model's own arithmetic is never trusted.
 */
export function buildSummary(fileReviews: FileReview[]): ReviewReport['summary'] {
  const totalFiles = fileReviews.length;
  const scoreSum = fileReviews.reduce((sum, f) => sum + f.codeQuality.overallScore, 0);

  return {
    totalFiles,
    overallScore: totalFiles === 0 ? 0 : Math.round(scoreSum / totalFiles),
    criticalIssues: fileReviews.reduce(
      (n, f) => n + f.codeQuality.issues.filter(i => i.severity === 'critical').length,
      0
    ),
    highPriorityTests: fileReviews.reduce(
      (n, f) =>
        n +
        f.testCoverage.untestedPaths.filter(
          p => p.priority === 'critical' || p.priority === 'high'
        ).length,
      0
    ),
    refactoringOpportunities: fileReviews.reduce(
      (n, f) => n + f.refactorings.suggestions.length,
      0
    )
  };
}

/** Builds follow-up recommendations straight from the per-file findings. */
export function deriveRecommendations(fileReviews: FileReview[]): ReviewReport['recommendations'] {
  const recs: ReviewReport['recommendations'] = [];

  const critical = fileReviews.filter(f => f.codeQuality.issues.some(i => i.severity === 'critical'));
  if (critical.length > 0) {
    recs.push({
      priority: 'critical',
      category: 'security',
      description: 'Fix the critical-severity issues before merging.',
      files: critical.map(f => f.file)
    });
  }

  const high = fileReviews.filter(f => f.codeQuality.issues.some(i => i.severity === 'high'));
  if (high.length > 0) {
    recs.push({
      priority: 'high',
      category: 'code-quality',
      description: 'Address the high-severity issues found in these files.',
      files: high.map(f => f.file)
    });
  }

  const untested = fileReviews.filter(f =>
    f.testCoverage.untestedPaths.some(p => p.priority === 'critical' || p.priority === 'high')
  );
  if (untested.length > 0) {
    recs.push({
      priority: 'high',
      category: 'testing',
      description: 'Add tests for the untested critical and high-priority code paths.',
      files: untested.map(f => f.file)
    });
  }

  const refactor = fileReviews.filter(f => f.refactorings.suggestions.length > 0);
  if (refactor.length > 0) {
    recs.push({
      priority: 'low',
      category: 'refactoring',
      description: 'Consider the suggested refactorings to improve readability and maintainability.',
      files: refactor.map(f => f.file)
    });
  }

  return recs;
}

/**
 * Builds the final report.
 *
 * `collected` holds the per-file results gathered directly from the subagents.
 * When present it takes precedence over whatever the orchestrating model put in
 * its structured output. The summary is always recomputed.
 */
export function finalizeReport(
  raw: unknown,
  pr: { owner: string; repo: string; number: number },
  durationMs: number,
  collected: FileReview[] = []
): ReviewReport {
  const parsed = raw === undefined ? undefined : ReviewReportSchema.safeParse(raw);

  if (parsed && !parsed.success && collected.length === 0) {
    throw new ReviewError(
      'Orchestrator output did not match the ReviewReport schema',
      ErrorCodes.STRUCTURED_OUTPUT_FAILED,
      { issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`) }
    );
  }

  const modelReport = parsed?.success ? parsed.data : undefined;
  const fileReviews = collected.length > 0 ? collected : (modelReport?.fileReviews ?? []);

  if (fileReviews.length === 0) {
    throw new ReviewError(
      'The review did not review any files. Check that the GitHub MCP server connected, ' +
        'GITHUB_TOKEN is valid, and the pull request has changed source files.',
      ErrorCodes.AGENT_FAILED
    );
  }

  const recommendations =
    modelReport && modelReport.recommendations.length > 0
      ? modelReport.recommendations
      : deriveRecommendations(fileReviews);

  return {
    pullRequest: pr,
    fileReviews,
    summary: buildSummary(fileReviews),
    recommendations,
    metadata: {
      analyzedAt: modelReport?.metadata.analyzedAt || new Date().toISOString(),
      duration: durationMs,
      agentVersions: modelReport?.metadata.agentVersions ?? {
        'code-quality-analyzer': '1.0.0',
        'test-coverage-analyzer': '1.0.0',
        'refactoring-suggester': '1.0.0'
      }
    }
  };
}

/**
 * Multi-agent pull request reviewer.
 *
 * One Agent SDK session acts as the orchestrator. It reads the PR through the
 * GitHub MCP server, delegates every source file to three subagents
 * (code quality, test coverage, refactoring) via the Task tool, and returns a
 * ReviewReport as schema-validated structured output.
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly projectRoot: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private readonly estimatedTokens: number;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd: number | undefined;
  private readonly rateLimiter: RateLimiter;
  private readonly queryFn: QueryFn;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULTS.model;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULTS.retryDelayMs;
    this.estimatedTokens = options.estimatedTokens ?? DEFAULTS.estimatedTokens;
    this.maxTurns = options.maxTurns ?? DEFAULTS.maxTurns;
    this.maxBudgetUsd = options.maxBudgetUsd;
    this.rateLimiter = new RateLimiter(options.rateLimits);
    this.queryFn = options.queryFn ?? query;
  }

  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  /** Reviews a pull request and returns the validated report. */
  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    const startedAt = Date.now();
    const pr = { owner, repo, number: prNumber };

    try {
      this.assertValidInput(owner, repo, prNumber);
      this.assertSkillsAvailable();
      logReviewStart(owner, repo, prNumber);

      const { raw, collected } = await withRetry(
        () => this.runOnce(pr),
        this.maxAttempts,
        this.retryDelayMs,
        error => !(error instanceof ReviewError && NON_RETRYABLE.has(error.code))
      );

      const report = finalizeReport(raw, pr, Date.now() - startedAt, collected);
      logReviewComplete(owner, repo, prNumber, report.summary.overallScore, report.metadata.duration);
      return report;
    } catch (error) {
      logReviewError(owner, repo, prNumber, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  // ---------------------------------------------------------------------------

  /** One attempt: rate limit, run the agent session, return its output and collected results. */
  private async runOnce(
    pr: { owner: string; repo: string; number: number }
  ): Promise<{ raw: unknown; collected: FileReview[] }> {
    await this.rateLimiter.acquire(this.estimatedTokens);
    const controller = new AbortController();
    const collector = new SubagentCollector();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    let tokensUsed: number | undefined;
    try {
      const session = this.queryFn({
        prompt: buildOrchestratorPrompt(pr),
        options: this.buildOptions(controller)
      });

      for await (const message of session) {
        this.logProgress(message);
        collector.observe(message);

        if (message.type === 'result') {
          tokensUsed = this.totalTokens(message);
          const collected = collector.buildFileReviews();
          const denied = (message as { permission_denials?: Array<{ tool_name?: string }> })
            .permission_denials ?? [];
          logger.info('Agent session finished', {
            subagentCalls: collector.taskCallCount,
            filesCollected: collected.length,
            deniedTools: [...new Set(denied.map(d => d.tool_name ?? 'unknown'))]
          });

          try {
            return { raw: this.extractStructuredOutput(message), collected };
          } catch (error) {
            // Subagent results are enough to build a report even if the
            // orchestrator's own structured output failed.
            if (collected.length > 0) {
              logger.warn('Using collected subagent results; structured output was unusable');
              return { raw: undefined, collected };
            }
            throw error;
          }
        }
      }
      throw new ReviewError('Agent session ended without a result', ErrorCodes.AGENT_FAILED);
    } catch (error) {
      if (timedOut) {
        throw new ReviewError(
          `Review timed out after ${this.timeoutMs} ms`,
          ErrorCodes.AGENT_TIMEOUT,
          { timeoutMs: this.timeoutMs }
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.rateLimiter.release(tokensUsed);
    }
  }

  private buildOptions(abortController: AbortController): Options {
    const options: Options = {
      model: this.model,
      cwd: this.projectRoot,
      systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
      agents: reviewAgents,
      mcpServers: buildMcpServersConfig(),
      // 'project' makes the SDK load .claude/skills from cwd so the Skill tool works.
      settingSources: ['project'],
      allowedTools: ['Task', 'Skill', 'Read', 'Grep', 'Glob', ...MCP_ALLOWED_TOOLS],
      // The reviewer is strictly read-only.
      disallowedTools: ['Bash', 'Write', 'Edit', 'NotebookEdit'],
      outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema },
      maxTurns: this.maxTurns,
      abortController
    };
    if (this.maxBudgetUsd !== undefined) options.maxBudgetUsd = this.maxBudgetUsd;
    return options;
  }

  private extractStructuredOutput(result: SDKResultMessage): unknown {
    if (result.subtype === 'success') {
      if (result.structured_output !== undefined) return result.structured_output;
      throw new ReviewError(
        'Agent finished without structured output',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED
      );
    }

    const code =
      result.subtype === 'error_max_structured_output_retries'
        ? ErrorCodes.STRUCTURED_OUTPUT_FAILED
        : ErrorCodes.AGENT_FAILED;
    throw new ReviewError(`Agent run failed: ${result.subtype}`, code, {
      subtype: result.subtype,
      turns: result.num_turns,
      costUsd: result.total_cost_usd
    });
  }

  private totalTokens(result: SDKResultMessage): number | undefined {
    const usage = result.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (!usage) return undefined;
    return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
  }

  /** Logs each subagent delegation so a run can be followed in the log. */
  private logProgress(message: SDKMessage): void {
    if (message.type === 'system' && (message as { subtype?: string }).subtype === 'init') {
      const servers = (message as unknown as { mcp_servers?: Array<{ name: string; status: string }> })
        .mcp_servers ?? [];
      for (const server of servers) {
        const text = `MCP server ${server.name}: ${server.status}`;
        if (server.status === 'connected') logger.info(text);
        else logger.warn(text);
      }
      return;
    }
    if (message.type !== 'assistant') return;
    const content = (message.message as { content?: unknown }).content;
    if (!Array.isArray(content)) return;

    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'tool_use' && block.name === 'Task') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        logAgentStart(String(input.subagent_type ?? 'unknown'), String(input.description ?? ''));
      }
    }
  }

  private assertValidInput(owner: string, repo: string, prNumber: number): void {
    const name = /^[A-Za-z0-9_.-]+$/;
    if (!name.test(owner) || !name.test(repo)) {
      throw new ReviewError(
        `Invalid repository reference "${owner}/${repo}"`,
        ErrorCodes.INVALID_CONFIG
      );
    }
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new ReviewError(
        `Invalid pull request number: ${prNumber}`,
        ErrorCodes.INVALID_CONFIG
      );
    }
  }

  private assertSkillsAvailable(): void {
    const skillsDir = path.join(this.projectRoot, '.claude', 'skills');
    if (!fs.existsSync(skillsDir)) {
      throw new ReviewError(
        `No .claude/skills directory found under PROJECT_ROOT (${this.projectRoot}). ` +
          'Set PROJECT_ROOT to the absolute path of this project.',
        ErrorCodes.INVALID_CONFIG,
        { skillsDir }
      );
    }
    if (!process.env.GITHUB_TOKEN) {
      logger.warn('GITHUB_TOKEN is not set; GitHub rate limits and private repos will be a problem');
    }
  }
}
