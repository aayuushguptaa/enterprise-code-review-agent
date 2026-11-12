import { describe, it, expect } from 'vitest';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  ReviewReportSchema,
  ReviewReportJSONSchema
} from '../src/types/index.js';
import { makeFileReview, makeRawReport } from './fixtures.js';

describe('analysis result schemas', () => {
  const review = makeFileReview('a.ts', { severities: ['high'], priorities: ['low'], refactorings: 1 });

  it('accept well-formed results', () => {
    expect(CodeQualityResultSchema.safeParse(review.codeQuality).success).toBe(true);
    expect(TestCoverageResultSchema.safeParse(review.testCoverage).success).toBe(true);
    expect(RefactoringSuggestionSchema.safeParse(review.refactorings).success).toBe(true);
  });

  it('reject out-of-range scores', () => {
    expect(CodeQualityResultSchema.safeParse({ ...review.codeQuality, overallScore: 101 }).success).toBe(false);
    expect(CodeQualityResultSchema.safeParse({ ...review.codeQuality, overallScore: -1 }).success).toBe(false);
    expect(TestCoverageResultSchema.safeParse({ ...review.testCoverage, coverageEstimate: 120 }).success).toBe(false);
  });

  it('reject unknown severities and categories', () => {
    const bad = { ...review.codeQuality, issues: [{ ...review.codeQuality.issues[0], severity: 'urgent' }] };
    expect(CodeQualityResultSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...review.codeQuality, issues: [{ ...review.codeQuality.issues[0], category: 'vibes' }] };
    expect(CodeQualityResultSchema.safeParse(bad2).success).toBe(false);
  });

  it('reject missing required fields', () => {
    const { summary: _omit, ...withoutSummary } = review.codeQuality;
    expect(CodeQualityResultSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe('ReviewReportSchema', () => {
  it('accepts a complete report and rejects an incomplete one', () => {
    expect(ReviewReportSchema.safeParse(makeRawReport()).success).toBe(true);
    const { metadata: _omit, ...partial } = makeRawReport();
    expect(ReviewReportSchema.safeParse(partial).success).toBe(false);
  });

  it('exposes a JSON Schema for SDK structured output', () => {
    const schema = ReviewReportJSONSchema as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });
});
