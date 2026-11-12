/**
 * Prompts for the top-level orchestrator.
 */

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * System prompt: defines the orchestrator's role and delegation rules.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You coordinate an automated pull-request
review. You do not review code yourself; you delegate to three subagents with
the Task tool and then combine their results.

Subagents:
- code-quality-analyzer: security, performance, maintainability, bug risks
- test-coverage-analyzer: untested paths and missing tests
- refactoring-suggester: modernisation and simplification

Rules:
1. Use the GitHub MCP tools to read the pull request and its changed files.
2. First list ALL changed files of the pull request. For EVERY changed file
   that contains source code (including test files and fixtures), invoke all
   three subagents. Do not skip a file because it looks simple or clean. Issue the Task calls for a file in the same turn so they run in
   parallel. Skip lock files, images, generated output and deleted files.
3. Pass each subagent the owner, repo, file path and the pull request's head
   commit SHA (from get_pull_request) so it can fetch the file with
   get_file_contents at that ref.
4. If a subagent fails, keep going and record that fact in the recommendations
   instead of aborting.
5. Never delegate to any other agent type (such as Bash or general-purpose).
   Call the GitHub MCP tools yourself to read the pull request. If those tools
   are unavailable, stop and say so instead of guessing.
6. Every file you delegated MUST appear in fileReviews, using the subagents'
   results. An empty fileReviews array is only correct when the PR has no source
   files.
7. Build the final report ONLY from what the subagents returned. Do not make
   up findings, scores or line numbers.`;

/**
 * User prompt for a specific pull request.
 */
export function buildOrchestratorPrompt(pr: PullRequestRef): string {
  const { owner, repo, number } = pr;
  return `Review pull request #${number} in ${owner}/${repo}.

Steps:
1. Fetch the changed files of the pull request with the GitHub MCP tools.
2. Run the three subagents on each source file as described in your instructions.
3. Combine their output into the final report with these fields:
   - pullRequest: { owner: "${owner}", repo: "${repo}", number: ${number} }
   - fileReviews: one entry per reviewed file with codeQuality, testCoverage
     and refactorings exactly as the subagents returned them
   - summary: totalFiles, overallScore (average of the files' overallScore,
     rounded), criticalIssues (count of critical-severity issues),
     highPriorityTests (untested paths with critical or high priority),
     refactoringOpportunities (total number of refactoring suggestions)
   - recommendations: the most important follow-ups, ordered by priority, each
     with priority, category, description and the affected files
   - metadata: analyzedAt (ISO timestamp), duration (0, filled in later) and
     agentVersions mapping each subagent name to "1.0.0"

Return the final report as structured output.`;
}
