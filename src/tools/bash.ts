import { spawn } from 'node:child_process'
import * as os from 'node:os'

import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

function detectEnv(): { osInfo: string; shell: string } {
  const platform = os.platform()
  const release = os.release()
  const arch = os.arch()

  if (platform === 'win32') {
    return {
      osInfo: `Windows ${release} (${arch})`,
      shell: 'powershell.exe',
    }
  }

  const osName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
  return {
    osInfo: `${osName} ${release} (${arch})`,
    shell: process.env.SHELL || '/bin/sh',
  }
}

const env = detectEnv()

function execCommand(
  command: string,
  timeout: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise(resolve => {
    const isWindows = os.platform() === 'win32'
    const shellExe = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/sh'
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command]

    const child = spawn(shellExe, shellArgs, {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already exited */
        }
      }, 5000)
    }, timeout)

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8')
    })

    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8')
    })

    child.on('close', code => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })

    child.on('error', err => {
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr + fmtErr(err), exitCode: 1 })
    })
  })
}

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: `Execute a shell command. Returns stdout and stderr.

Environment: ${env.osInfo}
Shell: ${env.shell}

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
      const { stdout, stderr, exitCode } = await execCommand(command, timeout)

      let output = ''
      if (stdout.trim()) output += stdout.trim()
      if (stderr.trim()) {
        output += output ? '\n' + stderr.trim() : stderr.trim()
      }
      if (!output) output = '(no output)'

      if (exitCode !== 0) {
        return {
          success: false,
          output,
          error: `Command exited with code ${exitCode}`,
        }
      }

      return { success: true, output }
    } catch (err) {
      const msg = fmtErr(err)
      return { success: false, output: '', error: `Command failed: ${msg}` }
    }
  },
}
