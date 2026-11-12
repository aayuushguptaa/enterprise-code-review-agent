import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { reviewAgents } from '../src/agents/index.js';
import { buildMcpServersConfig } from '../src/config/mcp.config.js';
import {
  CODE_QUALITY_PROMPT,
  TEST_COVERAGE_PROMPT,
  REFACTORING_PROMPT,
  ORCHESTRATOR_SYSTEM_PROMPT,
  buildOrchestratorPrompt
} from '../src/prompts/index.js';

const root = process.cwd();

describe('subagents', () => {
  it('registers exactly the three required subagents with prompts and descriptions', () => {
    expect(Object.keys(reviewAgents).sort()).toEqual([
      'code-quality-analyzer',
      'refactoring-suggester',
      'test-coverage-analyzer'
    ]);
    for (const agent of Object.values(reviewAgents)) {
      expect(agent.description.length).toBeGreaterThan(20);
      expect(agent.prompt.length).toBeGreaterThan(100);
      expect(agent.tools?.length).toBeGreaterThan(0);
    }
  });

  it('gives every subagent the Skill tool so all can read the skills library', () => {
    for (const [name, agent] of Object.entries(reviewAgents)) {
      expect(agent.tools, name).toContain('Skill');
    }
  });

  it('keeps all subagents read-only', () => {
    for (const agent of Object.values(reviewAgents)) {
      expect(agent.tools).not.toEqual(expect.arrayContaining(['Write']));
      expect(agent.tools).not.toContain('Edit');
      expect(agent.tools).not.toContain('Bash');
    }
  });

  it('lets the code-quality agent use skills and both MCP servers', () => {
    const tools = reviewAgents['code-quality-analyzer']!.tools!;
    expect(tools).toEqual(
      expect.arrayContaining(['Skill', 'mcp__github__get_file_contents', 'mcp__eslint__lint-files'])
    );
  });

  it('points every prompt at the matching schema fields', () => {
    expect(CODE_QUALITY_PROMPT).toContain('overallScore');
    expect(TEST_COVERAGE_PROMPT).toContain('untestedPaths');
    expect(REFACTORING_PROMPT).toContain('suggestions');
    expect(ORCHESTRATOR_SYSTEM_PROMPT).toContain('Task');
  });

  it('builds an orchestrator prompt containing the PR coordinates', () => {
    const p = buildOrchestratorPrompt({ owner: 'acme', repo: 'shop', number: 9 });
    expect(p).toContain('#9');
    expect(p).toContain('acme/shop');
  });
});

describe('MCP tool permissions', () => {
  it('allows only read-only GitHub tools, by exact name', async () => {
    const { MCP_ALLOWED_TOOLS } = await import('../src/config/mcp.config.js');
    expect(MCP_ALLOWED_TOOLS).toContain('mcp__github__get_pull_request_files');
    for (const tool of MCP_ALLOWED_TOOLS) {
      expect(tool).toMatch(/^mcp__(github|eslint)__[a-z_-]+$/);
      expect(tool).not.toMatch(/create|push|merge|update|fork|delete/);
    }
  });

  it('never gives a subagent a write tool', () => {
    for (const agent of Object.values(reviewAgents)) {
      for (const tool of agent.tools ?? []) {
        expect(tool).not.toMatch(/create|push|merge|update|fork|delete/);
      }
    }
  });
});

describe('MCP configuration', () => {
  it('defines github and eslint stdio servers', () => {
    const cfg = buildMcpServersConfig({ GITHUB_TOKEN: 'tok' } as NodeJS.ProcessEnv);
    expect(Object.keys(cfg).sort()).toEqual(['eslint', 'github']);
    expect((cfg.github as { env: Record<string, string> }).env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('tok');
  });

  it('reads the token at call time, not import time', () => {
    const cfg = buildMcpServersConfig({} as NodeJS.ProcessEnv);
    expect((cfg.github as { env: Record<string, string> }).env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('');
  });
});

describe('Claude Skills', () => {
  const skillsDir = path.join(root, '.claude', 'skills');
  const required = ['javascript-best-practices', 'typescript-patterns', 'security-analysis', 'python-code-review'];

  it.each(required)('%s has a SKILL.md with a description', name => {
    const file = path.join(skillsDir, name, 'SKILL.md');
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/^---\s*\ndescription:\s*\S+/);
  });

  it('every skill the prompts mention exists on disk', () => {
    for (const name of ['javascript-best-practices', 'typescript-patterns', 'python-code-review', 'security-analysis']) {
      expect(CODE_QUALITY_PROMPT).toContain(name);
      expect(fs.existsSync(path.join(skillsDir, name, 'SKILL.md'))).toBe(true);
    }
  });
});
