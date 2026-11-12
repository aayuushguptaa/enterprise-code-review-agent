/**
 * Centralised prompt management for the orchestrator and all subagents.
 */
export { CODE_QUALITY_PROMPT } from './code-quality-analyzer.prompt.js';
export { TEST_COVERAGE_PROMPT } from './test-coverage-analyzer.prompt.js';
export { REFACTORING_PROMPT } from './refactoring-suggester.prompt.js';
export {
  ORCHESTRATOR_SYSTEM_PROMPT,
  buildOrchestratorPrompt,
  type PullRequestRef
} from './orchestrator.prompt.js';
