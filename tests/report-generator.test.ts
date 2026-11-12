import { describe, it, expect } from 'vitest';
import { ReportGenerator } from '../src/utils/report-generator.js';
import { finalizeReport } from '../src/orchestrator.js';
import { makeFileReview, makeRawReport } from './fixtures.js';

const report = finalizeReport(
  makeRawReport([makeFileReview('src/pay.ts', { score: 55, severities: ['critical'], priorities: ['high'], refactorings: 1 })]),
  { owner: 'acme', repo: 'shop', number: 42 },
  1500
);
const gen = new ReportGenerator();

describe('ReportGenerator', () => {
  it('renders markdown with the PR and file names', () => {
    const md = gen.generateMarkdownReport(report);
    expect(md).toContain('acme/shop');
    expect(md).toContain('src/pay.ts');
  });

  it('renders HTML', () => {
    const html = gen.generateHTMLReport(report);
    expect(html).toContain('<html');
    expect(html).toContain('src/pay.ts');
  });

  it('renders JSON that round-trips', () => {
    expect(JSON.parse(gen.generateJSONReport(report)).summary.totalFiles).toBe(1);
  });
});

describe('ReportGenerator hardening', () => {
  it('escapes model-generated text in the HTML report', () => {
    const hostile = finalizeReport(
      makeRawReport([makeFileReview('src/<img src=x onerror=alert(1)>.ts')]),
      { owner: 'o', repo: 'r', number: 1 },
      1
    );
    hostile.recommendations[0]!.description = '<script>alert("x")</script>';
    const html = gen.generateHTMLReport(hostile);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});
