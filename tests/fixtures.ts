import type { ReviewReport } from '../src/types/index.js';

type FileReview = ReviewReport['fileReviews'][number];

/** Builds a valid per-file review; overrides are shallow-merged per section. */
export function makeFileReview(
  file: string,
  opts: {
    score?: number;
    severities?: Array<'critical' | 'high' | 'medium' | 'low' | 'info'>;
    priorities?: Array<'critical' | 'high' | 'medium' | 'low'>;
    refactorings?: number;
  } = {}
): FileReview {
  const { score = 80, severities = [], priorities = [], refactorings = 0 } = opts;
  return {
    file,
    codeQuality: {
      file,
      issues: severities.map((severity, i) => ({
        line: i + 1,
        severity,
        category: 'security' as const,
        description: `issue ${i}`,
        suggestion: `fix ${i}`
      })),
      overallScore: score,
      summary: 'quality summary'
    },
    testCoverage: {
      file,
      hasTests: priorities.length === 0,
      testFiles: [],
      untestedPaths: priorities.map((priority, i) => ({
        type: 'function' as const,
        location: `fn${i}`,
        priority,
        reasoning: 'not covered',
        suggestedTest: 'add a test'
      })),
      coverageEstimate: 50,
      summary: 'coverage summary'
    },
    refactorings: {
      file,
      suggestions: Array.from({ length: refactorings }, (_, i) => ({
        type: 'simplify' as const,
        location: `line ${i}`,
        impact: 'medium' as const,
        description: 'simplify',
        before: 'a',
        after: 'b',
        benefits: 'clearer'
      })),
      summary: 'refactoring summary'
    }
  };
}

/** A valid raw report as the orchestrator model might return it (with wrong totals). */
export function makeRawReport(fileReviews: FileReview[] = [makeFileReview('src/a.ts')]) {
  return {
    pullRequest: { owner: 'o', repo: 'r', number: 1 },
    fileReviews,
    summary: {
      totalFiles: 999,
      overallScore: 1,
      criticalIssues: 999,
      highPriorityTests: 999,
      refactoringOpportunities: 999
    },
    recommendations: [
      { priority: 'high' as const, category: 'security', description: 'fix it', files: ['src/a.ts'] }
    ],
    metadata: {
      analyzedAt: '2026-01-01T00:00:00.000Z',
      duration: 0,
      agentVersions: { 'code-quality-analyzer': '1.0.0' }
    }
  };
}

/** Creates a fake query() that yields the given messages. */
export function fakeQuery(messages: unknown[], onCall?: (params: unknown) => void) {
  return ((params: unknown) => {
    onCall?.(params);
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  }) as never;
}

export function successMessage(structured: unknown) {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 3,
    total_cost_usd: 0.01,
    usage: { input_tokens: 1000, output_tokens: 500 },
    structured_output: structured
  };
}
