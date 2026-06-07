import { exec } from 'node:child_process'
import * as os from 'node:os'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

function detectShell(): string {
  const platform = os.platform()
  const release = os.release()
  const arch = process.arch

  if (platform === 'win32') {
    return `Windows ${release} (${arch})`
  }

  const osName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
  return `${osName} ${release} (${arch})`
}

const envInfo = detectShell()

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: `Execute a shell command. Returns stdout and stderr.

Environment: ${envInfo}

      ⚠️ IMPORTANT: Do NOT use this tool to create or modify files. Use the 'edit' tool for file modifications instead.`,
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
      const msg = fmtErr(err)
      return { success: false, output: '', error: `Command failed: ${msg}` }
    }
  },
}
