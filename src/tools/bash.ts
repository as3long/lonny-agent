import { exec } from 'node:child_process'
import { promisify } from 'node:util'
const execAsync = promisify(exec)
import { Tool, ToolResult } from './types.js'

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: 'Execute a shell command. Returns stdout and stderr.',
    parameters: {
      command: { type: 'string', description: 'Shell command to execute', required: true },
      description: { type: 'string', description: 'Brief description of what the command does' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000)' },
    },
  },
  async execute(input): Promise<ToolResult> {
    const command = input.command as string
    if (!command) {
      return { success: false, output: '', error: 'command is required' }
    }

    const timeout = (input.timeout as number) || 120_000

    try {
      const { stdout } = await execAsync(command, {
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      })
      return { success: true, output: stdout || '(no output)' }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, output: '', error: `Command failed: ${msg}` }
    }
  },
}
