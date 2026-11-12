import { describe, it, expect } from 'vitest';
import {
  CodeReviewOrchestrator,
  buildSummary,
  finalizeReport
} from '../src/orchestrator.js';
import { ErrorCodes, ReviewError } from '../src/utils/error-handler.js';
import { fakeQuery, makeFileReview, makeRawReport, successMessage } from './fixtures.js';

const projectRoot = process.cwd();
const fast = { retryDelayMs: 1, projectRoot };

describe('buildSummary', () => {
  it('returns zeros for an empty review', () => {
    expect(buildSummary([])).toEqual({
      totalFiles: 0,
      overallScore: 0,
      criticalIssues: 0,
      highPriorityTests: 0,
      refactoringOpportunities: 0
    });
  });

  it('averages scores and counts critical issues, high-priority tests and refactorings', () => {
    const summary = buildSummary([
      makeFileReview('a.ts', { score: 70, severities: ['critical', 'low'], priorities: ['high'], refactorings: 2 }),
      makeFileReview('b.ts', { score: 91, severities: ['critical', 'critical'], priorities: ['critical', 'low'], refactorings: 1 })
    ]);
    expect(summary).toEqual({
      totalFiles: 2,
      overallScore: 81, // (70 + 91) / 2 = 80.5 -> 81
      criticalIssues: 3,
      highPriorityTests: 2,
      refactoringOpportunities: 3
    });
  });
});

describe('finalizeReport', () => {
  it('overwrites model-supplied totals and sets duration', () => {
    const raw = makeRawReport([makeFileReview('a.ts', { score: 60, severities: ['critical'] })]);
    const report = finalizeReport(raw, { owner: 'o', repo: 'r', number: 1 }, 1234);
    expect(report.summary.totalFiles).toBe(1);
    expect(report.summary.overallScore).toBe(60);
    expect(report.summary.criticalIssues).toBe(1);
    expect(report.metadata.duration).toBe(1234);
  });

  it('rejects output that does not match the schema', () => {
    try {
      finalizeReport({ nope: true }, { owner: 'o', repo: 'r', number: 1 }, 1);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ReviewError);
      expect((e as ReviewError).code).toBe(ErrorCodes.STRUCTURED_OUTPUT_FAILED);
    }
  });
});

describe('CodeReviewOrchestrator.reviewPullRequest', () => {
  it('returns a validated report from structured output', async () => {
    const orchestrator = new CodeReviewOrchestrator({
      ...fast,
      queryFn: fakeQuery([{ type: 'system' }, successMessage(makeRawReport())])
    });
    const report = await orchestrator.reviewPullRequest('o', 'r', 1);
    expect(report.pullRequest).toEqual({ owner: 'o', repo: 'r', number: 1 });
    expect(report.fileReviews).toHaveLength(1);
    expect(report.summary.totalFiles).toBe(1);
  });

  it('configures the SDK with subagents, MCP, skills and structured output', async () => {
    let captured: any;
    const orchestrator = new CodeReviewOrchestrator({
      ...fast,
      queryFn: fakeQuery([successMessage(makeRawReport())], p => (captured = p))
    });
    await orchestrator.reviewPullRequest('o', 'r', 7);

    expect(captured.prompt).toContain('#7');
    const opts = captured.options;
    expect(Object.keys(opts.agents).sort()).toEqual([
      'code-quality-analyzer',
      'refactoring-suggester',
      'test-coverage-analyzer'
    ]);
    expect(Object.keys(opts.mcpServers).sort()).toEqual(['eslint', 'github']);
    expect(opts.settingSources).toContain('project');
    expect(opts.allowedTools).toEqual(expect.arrayContaining(['Task', 'Skill']));
    expect(opts.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit']));
    expect(opts.outputFormat.type).toBe('json_schema');
    expect(opts.cwd).toBe(projectRoot);
  });

  it('retries once when the first attempt fails, then succeeds', async () => {
    let calls = 0;
    const queryFn = (() => {
      calls++;
      const msg = calls === 1 ? { type: 'result', subtype: 'error_during_execution', num_turns: 1, total_cost_usd: 0, usage: {} } : successMessage(makeRawReport());
      return (async function* () { yield msg; })();
    }) as never;

    const orchestrator = new CodeReviewOrchestrator({ ...fast, maxAttempts: 2, queryFn });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it('fails with RETRY_EXHAUSTED after all attempts fail', async () => {
    const orchestrator = new CodeReviewOrchestrator({
      ...fast,
      maxAttempts: 2,
      queryFn: fakeQuery([{ type: 'result', subtype: 'error_max_turns', num_turns: 40, total_cost_usd: 0, usage: {} }])
    });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED
    });
  });

  it('fails when the session ends without a result', async () => {
    const orchestrator = new CodeReviewOrchestrator({ ...fast, maxAttempts: 1, queryFn: fakeQuery([{ type: 'system' }]) });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toBeInstanceOf(ReviewError);
  });

  it('times out without retrying', async () => {
    let calls = 0;
    const queryFn = ((params: any) => {
      calls++;
      return (async function* () {
        await new Promise((_, reject) =>
          params.options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted')))
        );
        yield undefined;
      })();
    }) as never;

    const orchestrator = new CodeReviewOrchestrator({ ...fast, timeoutMs: 30, maxAttempts: 3, queryFn });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
      code: ErrorCodes.AGENT_TIMEOUT
    });
    expect(calls).toBe(1);
  });

  it.each([
    ['bad owner', 'bad owner!', 'r', 1],
    ['bad repo', 'o', '../x', 1],
    ['zero pr', 'o', 'r', 0],
    ['negative pr', 'o', 'r', -4],
    ['fractional pr', 'o', 'r', 1.5]
  ])('rejects invalid input: %s', async (_label, owner, repo, pr) => {
    const orchestrator = new CodeReviewOrchestrator({ ...fast, queryFn: fakeQuery([]) });
    await expect(orchestrator.reviewPullRequest(owner, repo, pr)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG
    });
  });

  it('fails fast when PROJECT_ROOT has no .claude/skills', async () => {
    let called = false;
    const orchestrator = new CodeReviewOrchestrator({
      projectRoot: '/definitely/not/here',
      queryFn: fakeQuery([], () => (called = true))
    });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG
    });
    expect(called).toBe(false);
  });

  it('releases its rate-limit slot even when a run fails', async () => {
    const orchestrator = new CodeReviewOrchestrator({
      ...fast,
      maxAttempts: 1,
      queryFn: fakeQuery([{ type: 'result', subtype: 'error_max_turns', num_turns: 1, total_cost_usd: 0, usage: {} }])
    });
    await orchestrator.reviewPullRequest('o', 'r', 1).catch(() => undefined);
    expect(orchestrator.getRateLimitStatus().activeRequests).toBe(0);
  });
});

describe('empty reviews', () => {
  it('fails instead of reporting success when no files were reviewed', () => {
    expect(() =>
      finalizeReport(makeRawReport([]), { owner: 'o', repo: 'r', number: 1 }, 1)
    ).toThrowError(/did not review any files/);
  });
});
