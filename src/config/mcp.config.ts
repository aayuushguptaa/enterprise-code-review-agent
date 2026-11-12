import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

/**
 * Model Context Protocol servers available to the orchestrator and subagents.
 *
 * - github: read pull requests and file contents
 * - eslint: lint JavaScript/TypeScript files for supporting evidence
 *
 * Built by a function (not a constant) so environment variables are read at
 * call time, after dotenv has loaded .env.
 */
export function buildMcpServersConfig(
  env: NodeJS.ProcessEnv = process.env
): Record<string, McpServerConfig> {
  return {
    github: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        // The GitHub MCP server expects this variable name.
        GITHUB_PERSONAL_ACCESS_TOKEN: env.GITHUB_TOKEN ?? ''
      }
    },
    eslint: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@eslint/mcp@latest'],
      env: {}
    }
  };
}

/**
 * Exact MCP tool names the agents may call.
 *
 * The GitHub server also exposes write tools (create_or_update_file,
 * push_files, merge_pull_request, ...). A reviewer must never have those, so
 * only the read-only tools are listed, and by full name: a bare server prefix
 * such as "mcp__github" does not reliably grant permission to its tools.
 */
export const GITHUB_PR_TOOLS = [
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_files',
  'mcp__github__list_pull_requests'
];
export const GITHUB_FILE_TOOLS = [
  'mcp__github__get_file_contents',
  'mcp__github__search_code'
];
export const ESLINT_TOOLS = ['mcp__eslint__lint-files'];

/** Everything the orchestrator session is allowed to use from MCP servers. */
export const MCP_ALLOWED_TOOLS = [...GITHUB_PR_TOOLS, ...GITHUB_FILE_TOOLS, ...ESLINT_TOOLS];
