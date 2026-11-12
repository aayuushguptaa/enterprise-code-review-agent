import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { REFACTORING_PROMPT } from '../prompts/index.js';
import { GITHUB_FILE_TOOLS } from '../config/mcp.config.js';


/**
 * Subagent: behaviour-preserving modernisation and simplification ideas.
 */
export const refactoringSuggester: AgentDefinition = {
  description:
    'Suggests behaviour-preserving refactorings for one changed file, with before/after ' +
    'snippets and an impact rating. Use for every source file in a PR.',
  prompt: REFACTORING_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill', ...GITHUB_FILE_TOOLS],
  model: 'inherit'
};
