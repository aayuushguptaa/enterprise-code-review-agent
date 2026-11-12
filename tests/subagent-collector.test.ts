import { describe, it, expect } from 'vitest';
import { SubagentCollector, extractJsonObject } from '../src/utils/subagent-collector.js';
import { CodeReviewOrchestrator, finalizeReport, deriveRecommendations } from '../src/orchestrator.js';
import { fakeQuery, makeFileReview, makeRawReport, successMessage } from './fixtures.js';

const review = makeFileReview('src/App.jsx', { score: 64, severities: ['critical', 'low'], priorities: ['high'], refactorings: 2 });

const taskCall = (id: string, agent: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_use', id, name: 'Task', input: { subagent_type: agent, description: 'x' } }] }
});
const taskResult = (id: string, payload: unknown, fenced = false) => ({
  type: 'user',
  parent_tool_use_id: null,
  message: {
    content: [{
      type: 'tool_result',
      tool_use_id: id,
      content: [{ type: 'text', text: fenced ? '```json\n' + JSON.stringify(payload) + '\n```' : JSON.stringify(payload) }]
    }]
  }
});

const threeSubagents = () => [
  taskCall('t1', 'code-quality-analyzer'),
  taskCall('t2', 'test-coverage-analyzer'),
  taskCall('t3', 'refactoring-suggester'),
  taskResult('t1', review.codeQuality),
  taskResult('t2', review.testCoverage, true),
  taskResult('t3', review.refactorings)
];

describe('extractJsonObject', () => {
  it('reads plain, fenced and commentary-wrapped JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJsonObject('Here you go: {"a":3} hope it helps')).toEqual({ a: 3 });
  });
  it('returns undefined when there is no valid JSON', () => {
    expect(extractJsonObject('no json here')).toBeUndefined();
    expect(extractJsonObject('{broken')).toBeUndefined();
  });
});

describe('SubagentCollector', () => {
  it('builds a file review from the three subagents', () => {
    const c = new SubagentCollector();
    threeSubagents().forEach(m => c.observe(m as never));
    const reviews = c.buildFileReviews();
    expect(c.taskCallCount).toBe(3);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.codeQuality.overallScore).toBe(64);
    expect(reviews[0]!.refactorings.suggestions).toHaveLength(2);
  });

  it('ignores messages from inside subagents and non-subagent tasks', () => {
    const c = new SubagentCollector();
    c.observe({ ...taskCall('x', 'code-quality-analyzer'), parent_tool_use_id: 'outer' } as never);
    c.observe(taskCall('y', 'Bash') as never);
    c.observe(taskResult('y', review.codeQuality) as never);
    expect(c.buildFileReviews()).toHaveLength(0);
  });

  it('skips invalid subagent output and labels missing sections', () => {
    const c = new SubagentCollector();
    c.observe(taskCall('a', 'code-quality-analyzer') as never);
    c.observe(taskCall('b', 'test-coverage-analyzer') as never);
    c.observe(taskResult('a', review.codeQuality) as never);
    c.observe(taskResult('b', { file: 'x', nonsense: true }) as never);
    const [r] = c.buildFileReviews();
    expect(r!.testCoverage.summary).toMatch(/not returned/);
    expect(r!.refactorings.suggestions).toEqual([]);
  });
});

describe('finalizeReport with collected results', () => {
  const pr = { owner: 'o', repo: 'r', number: 1 };

  it('uses collected reviews even when the model returned none', () => {
    const emptyModelReport = makeRawReport([]);
    const report = finalizeReport(emptyModelReport, pr, 10, [review]);
    expect(report.fileReviews).toHaveLength(1);
    expect(report.summary.criticalIssues).toBe(1);
  });

  it('works with no model output at all', () => {
    const report = finalizeReport(undefined, pr, 10, [review]);
    expect(report.summary.totalFiles).toBe(1);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('still fails when nothing was reviewed anywhere', () => {
    expect(() => finalizeReport(makeRawReport([]), pr, 10, [])).toThrowError(/did not review any files/);
  });

  it('derives recommendations from findings', () => {
    const cats = deriveRecommendations([review]).map(r => r.category);
    expect(cats).toEqual(['security', 'testing', 'refactoring']);
  });
});

describe('orchestrator end to end with a weak orchestrating model', () => {
  const opts = { retryDelayMs: 1, projectRoot: process.cwd() };

  it('recovers when structured output has an empty fileReviews list', async () => {
    const o = new CodeReviewOrchestrator({
      ...opts,
      queryFn: fakeQuery([...threeSubagents(), successMessage(makeRawReport([]))])
    });
    const report = await o.reviewPullRequest('o', 'r', 1);
    expect(report.fileReviews.map(f => f.file)).toEqual(['src/App.jsx']);
  });

  it('recovers when structured output is missing entirely', async () => {
    const o = new CodeReviewOrchestrator({
      ...opts,
      maxAttempts: 1,
      queryFn: fakeQuery([
        ...threeSubagents(),
        { type: 'result', subtype: 'error_max_structured_output_retries', num_turns: 5, total_cost_usd: 0, usage: {} }
      ])
    });
    const report = await o.reviewPullRequest('o', 'r', 1);
    expect(report.summary.totalFiles).toBe(1);
  });

  it('fails clearly when the orchestrator never calls any subagent', async () => {
    const o = new CodeReviewOrchestrator({ ...opts, queryFn: fakeQuery([successMessage(makeRawReport([]))]) });
    await expect(o.reviewPullRequest('o', 'r', 1)).rejects.toThrowError(/did not review any files/);
  });
});

describe('near-miss subagent labels (seen in a real run)', () => {
  const collect = (agent: string, payload: unknown) => {
    const c = new SubagentCollector();
    c.observe(taskCall('a', 'code-quality-analyzer') as never);
    c.observe(taskResult('a', review.codeQuality) as never);
    c.observe(taskCall('b', agent) as never);
    c.observe(taskResult('b', payload) as never);
    return c.buildFileReviews()[0]!;
  };

  it('maps "error-path" to a valid untested-path type', () => {
    const r = collect('test-coverage-analyzer', {
      ...review.testCoverage,
      untestedPaths: [{ type: 'error-path', location: 'save()', priority: 'high', reasoning: 'r', suggestedTest: 't' }]
    });
    expect(r.testCoverage.untestedPaths[0]!.type).toBe('edge-case');
    expect(r.testCoverage.untestedPaths[0]!.priority).toBe('high');
  });

  it('maps "modernize-syntax" and joins a benefits array', () => {
    const r = collect('refactoring-suggester', {
      file: review.codeQuality.file,
      summary: 's',
      suggestions: [{
        type: 'modernize-syntax', location: 'l', impact: 'high',
        description: 'd', before: 'a', after: 'b', benefits: ['faster', 'clearer']
      }]
    });
    expect(r.refactorings.suggestions[0]!.type).toBe('modernize');
    expect(r.refactorings.suggestions[0]!.benefits).toBe('faster; clearer');
  });

  it('still rejects output that is structurally wrong', () => {
    const r = collect('refactoring-suggester', { suggestions: 'not an array' });
    expect(r.refactorings.summary).toMatch(/not returned/);
  });
});
