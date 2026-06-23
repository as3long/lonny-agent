import * as os from 'node:os'
import type { Config } from '../config/index.js'
import type { ToolDefinition } from '../tools/types.js'

/**
 * Build a minimal system prompt for a sub-agent.
 * Much lighter than the main system prompt — no long-term memory,
 * no skills, no full project context, no conversation history.
 *
 * Only includes:
 * - Environment info (platform, shell, cwd, OS)
 * - Task description
 * - Relevant code context
 * - Tool list
 * - Basic rules
 */
export function buildSubAgentPrompt(
  config: Config,
  task: string,
  context?: string,
  mode?: 'code' | 'loop',
): string {
  const platform = os.platform()
  const release = os.release()
  const shell = process.env.SHELL || process.env.ComSpec || 'unknown'
  const arch = os.arch()
  const cwd = config.cwd
  const isWindows = platform === 'win32'
  const effectiveMode = mode || config.mode || 'code'

  const envSection = `Environment:
  - Platform: ${platform} ${release} (${arch})
  - Shell: ${shell}
  - Working directory: ${cwd}
  - OS: ${isWindows ? 'Windows' : 'Linux/macOS'}
    - Available shell commands: ${isWindows ? 'PowerShell (cmd is also available but PowerShell is preferred)' : 'bash'}
  ${isWindows ? '⚠️  THIS IS WINDOWS. Do NOT use Unix/Linux paths like `/workspace/...` or `/home/...`.' : ''}
  ${isWindows ? '⚠️  Do NOT use Unix commands: `find`, `cat`, `ls -la`, `which`, `cp`, `mv`, `rm`, `touch`, `chmod`, `mkdir`, `grep`, `head`, `tail`.' : ''}
  ${isWindows ? '- Use `type` instead of `cat`, `dir` instead of `ls`, `where` instead of `which`.' : ''}`

  const toolSection = `Available tools:
  - \`read\`: Read file contents (paths: string[])
  - \`glob\`: Find files by glob pattern (pattern: string)
  - \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
  - \`ls\`: List directory (path?: string)
  - \`find\`: Find files by name pattern (pattern: string, path?: string, maxResults?: number)
  - \`bash\`: Execute a shell command
  - \`edit\`: Replace text in files using markdown code block format
  - \`fetch\`: Fetch content from a URL
  - \`search\`: Search the web using Tavily
  ${
    effectiveMode === 'code' || effectiveMode === 'loop'
      ? `- \`git\`: Run git commands (command: string)
  - \`ast_query\`, \`ast_edit\`: AST manipulation tools (use via \`tool()\` gateway)`
      : ''
  }

  For extended tools, use: tool({ name: "...", params: { ... } })`

  const rulesSection = `RULES:
  1. Read first: Use read/grep/glob tools to gather context before making edits.
  2. Be thorough: Explore the relevant parts of the codebase.
  3. After making edits, verify they work by running tests.
  4. Do NOT use \`delegate\` tool — delegate cannot be called from a sub-agent.
  5. Do NOT use \`task_complete\` tool — the sub-agent does not control session lifecycle.
  6. When done, summarize what you accomplished in your response.`

  const contextSection = context ? `\n## Relevant Context\n\n${context}` : ''

  return `You are a sub-agent. Complete the following task and report back with a summary of what you did.

  ${envSection}

  ${toolSection}

  ${rulesSection}

  ## Task

  ${task}${contextSection}`
}

/**
 * Build a minimal set of tool definitions for the sub-agent's LLM call.
 * Filters out tools that sub-agents should not call (delegate, task_complete).
 */
export function buildSubAgentToolDefinitions(allDefinitions: ToolDefinition[]): ToolDefinition[] {
  const blocked = new Set(['delegate', 'task_complete'])
  return allDefinitions.filter(d => !blocked.has(d.name))
}

/**
 * Estimate the token savings from using a sub-agent.
 * Returns the estimated tokens in the sub-agent's internal messages
 * that were NOT added to the main context.
 */
export function estimateSubAgentSavings(
  subMessages: { role: string; content?: string | null }[],
  summaryLength: number,
): number {
  const subTokens = subMessages.reduce((sum, m) => sum + Math.ceil((m.content || '').length / 4), 0)
  const summaryTokens = Math.ceil(summaryLength / 4)
  return Math.max(0, subTokens - summaryTokens)
}
