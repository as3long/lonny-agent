import { execSync } from 'node:child_process'
import { Tool, ToolResult } from './types.js'

/** Regex patterns that indicate a command WRITES to the filesystem.
 *  The bash tool must be read-only — use `edit` for all file mutations. */
const WRITE_PATTERNS = [
  />\s+(?!&)\S/,                            // cmd ... > file  (redirect, not 2>&1)
  />>\s*\S/,                                 // cmd >> file (append)
  /(?:^|[|;&]\s*)(?:touch|cp|mv|rm|rmdir|tee|dd|install|ln)\b/,
  /<<\s*['"]?\w+['"]?/,                      // heredoc redirection
  /\|\s*tee\b/,                              // pipe to tee
]

function isWriteCommand(command: string): boolean {
  // Strip comments
  const stripped = command.replace(/#.*$/gm, '')
  return WRITE_PATTERNS.some(re => re.test(stripped))
}

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: 'Execute a READ-ONLY shell command. For reading files, listing directories, running git status, etc. NEVER use this tool to edit, create, or delete files — use `edit` instead.',
    parameters: {
      command: { type: 'string', description: 'Read-only shell command to execute', required: true },
      description: { type: 'string', description: 'Brief description of what the command does' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
    },
  },
  async execute(input): Promise<ToolResult> {
    const command = input.command as string
    if (!command) {
      return { success: false, output: '', error: 'command is required' }
    }

    if (isWriteCommand(command)) {
      return {
        success: false,
        output: '',
        error: `bash tool is READ-ONLY. Use \`edit\` for file changes.\nDetected write operation in: ${command.slice(0, 200)}`,
      }
    }

    const timeout = (input.timeout as number) || 120_000

    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return { success: true, output: output || '(no output)' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: '', error: `Command failed: ${msg}` }
    }
  },
}
