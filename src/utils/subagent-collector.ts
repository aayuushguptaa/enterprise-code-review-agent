import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  type ReviewReport
} from '../types/index.js';
import { logger } from './logger.js';

export type FileReview = ReviewReport['fileReviews'][number];

type CodeQuality = FileReview['codeQuality'];
type TestCoverage = FileReview['testCoverage'];
type Refactorings = FileReview['refactorings'];

/**
 * Extracts the first JSON object from model text, tolerating markdown fences
 * and surrounding commentary.
 */
export function extractJsonObject(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T, hints: Array<[string, T]> = []): T => {
  const text = String(value ?? '').toLowerCase();
  if ((allowed as readonly string[]).includes(text)) return text as T;
  for (const [needle, target] of hints) if (text.includes(needle)) return target;
  return fallback;
};

const asString = (value: unknown): string =>
  Array.isArray(value) ? value.map(String).join('; ') : value === undefined || value === null ? '' : String(value);

/**
 * Subagents are language models: they sometimes return a label that is close
 * to, but not exactly, one of the schema's allowed values. Map those to the
 * nearest valid value so one near-miss does not discard a whole analysis.
 * Anything that is still invalid afterwards is rejected by the Zod schema.
 */
export function normalizeSubagentOutput(agent: string, json: unknown): unknown {
  if (!json || typeof json !== 'object') return json;
  const obj = JSON.parse(JSON.stringify(json)) as Record<string, any>;

  if (agent === 'code-quality-analyzer' && Array.isArray(obj.issues)) {
    obj.issues = obj.issues.map((i: any) => ({
      ...i,
      line: Number.isFinite(Number(i.line)) ? Number(i.line) : 0,
      severity: pick(i.severity, ['critical', 'high', 'medium', 'low', 'info'] as const, 'medium',
        [['error', 'high'], ['warn', 'medium'], ['minor', 'low']]),
      category: pick(i.category, ['security', 'performance', 'maintainability', 'style', 'bug-risk', 'best-practice'] as const, 'best-practice',
        [['secur', 'security'], ['perf', 'performance'], ['maintain', 'maintainability'], ['style', 'style'], ['bug', 'bug-risk']]),
      description: asString(i.description),
      suggestion: asString(i.suggestion)
    }));
  }

  if (agent === 'test-coverage-analyzer' && Array.isArray(obj.untestedPaths)) {
    obj.untestedPaths = obj.untestedPaths.map((p: any) => ({
      ...p,
      type: pick(p.type, ['function', 'class', 'branch', 'edge-case'] as const, 'edge-case',
        [['class', 'class'], ['branch', 'branch'], ['function', 'function'], ['method', 'function']]),
      priority: pick(p.priority, ['critical', 'high', 'medium', 'low'] as const, 'medium'),
      reasoning: asString(p.reasoning),
      suggestedTest: asString(p.suggestedTest)
    }));
  }

  if (agent === 'refactoring-suggester' && Array.isArray(obj.suggestions)) {
    obj.suggestions = obj.suggestions.map((r: any) => ({
      ...r,
      type: pick(r.type, ['extract-function', 'rename', 'modernize', 'simplify', 'pattern-improvement'] as const, 'simplify',
        [['extract', 'extract-function'], ['renam', 'rename'], ['naming', 'rename'], ['modern', 'modernize'], ['pattern', 'pattern-improvement'], ['simplif', 'simplify']]),
      impact: pick(r.impact, ['low', 'medium', 'high'] as const, 'medium'),
      benefits: asString(r.benefits),
      description: asString(r.description),
      before: asString(r.before),
      after: asString(r.after)
    }));
  }

  return obj;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(block => (block && typeof block === 'object' && 'text' in block ? String((block as { text: unknown }).text) : ''))
      .join('\n');
  }
  return '';
}

/**
 * Watches an Agent SDK session and records what each subagent returned.
 *
 * The orchestrating model is only trusted to coordinate. The per-file results
 * come straight from the subagents' own outputs and are validated here, so a
 * weak or distracted orchestrator cannot silently drop them.
 */
export class SubagentCollector {
  private readonly pending = new Map<string, string>();
  private readonly codeQuality = new Map<string, CodeQuality>();
  private readonly testCoverage = new Map<string, TestCoverage>();
  private readonly refactorings = new Map<string, Refactorings>();
  private taskCalls = 0;

  get taskCallCount(): number {
    return this.taskCalls;
  }

  observe(message: SDKMessage): void {
    // Ignore messages produced inside a subagent; only the orchestrator's own
    // view of the Task calls and their results matters.
    if ((message as { parent_tool_use_id?: string | null }).parent_tool_use_id) return;

    const content = (message as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content as Array<Record<string, unknown>>) {
      if (message.type === 'assistant' && block.type === 'tool_use' && block.name === 'Task') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        this.taskCalls++;
        this.pending.set(String(block.id), String(input.subagent_type ?? ''));
      } else if (message.type === 'user' && block.type === 'tool_result') {
        const agent = this.pending.get(String(block.tool_use_id));
        if (agent) this.record(agent, toolResultText(block.content));
      }
    }
  }

  private record(agent: string, text: string): void {
    const json = extractJsonObject(text);
    if (json === undefined) {
      logger.warn(`Subagent ${agent} returned no JSON`, { preview: text.slice(0, 200) });
      return;
    }

    const schemas = {
      'code-quality-analyzer': CodeQualityResultSchema,
      'test-coverage-analyzer': TestCoverageResultSchema,
      'refactoring-suggester': RefactoringSuggestionSchema
    } as const;
    const schema = schemas[agent as keyof typeof schemas];
    if (!schema) return; // not one of our subagents

    const parsed = schema.safeParse(normalizeSubagentOutput(agent, json));
    if (!parsed.success) {
      logger.warn(`Subagent ${agent} output failed validation`, {
        issues: parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`)
      });
      return;
    }

    const file = parsed.data.file;
    if (agent === 'code-quality-analyzer') this.codeQuality.set(file, parsed.data as CodeQuality);
    else if (agent === 'test-coverage-analyzer') this.testCoverage.set(file, parsed.data as TestCoverage);
    else this.refactorings.set(file, parsed.data as Refactorings);
    logger.info(`Collected ${agent} result`, { file });
  }

  /**
   * One review per file that has a code-quality result. Sections a subagent
   * never delivered are filled with clearly labelled placeholders.
   */
  buildFileReviews(): FileReview[] {
    return [...this.codeQuality.entries()].map(([file, codeQuality]) => ({
      file,
      codeQuality,
      testCoverage:
        this.testCoverage.get(file) ?? {
          file,
          hasTests: false,
          testFiles: [],
          untestedPaths: [],
          coverageEstimate: 0,
          summary: 'Test coverage analysis was not returned for this file.'
        },
      refactorings:
        this.refactorings.get(file) ?? {
          file,
          suggestions: [],
          summary: 'Refactoring analysis was not returned for this file.'
        }
    }));
  }
}
