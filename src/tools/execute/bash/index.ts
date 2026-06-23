import * as os from 'node:os'

import { fmtErr } from '../../errors.js'
import type { Tool, ToolResult } from '../../types.js'
import { MAX_OUTPUT_LENGTH } from './constants.js'
import { buildErrorMsg, extractPowerShellNativeOutput, truncateOutput } from './errors.js'
import { execCommand } from './execution.js'
import { ENCODING, env } from './platform.js'
import { checkDestructive, redactSensitive } from './security.js'
import { validateInput } from './validation.js'

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    category: 'Execute',
    group: 'Shell',
    description: `Execute a shell command. Returns stdout and stderr.

Environment: ${env.osInfo}
Shell: ${env.shell}
Console encoding: ${ENCODING}

⚠️  Use this tool for READ-ONLY operations (run tests, check builds, list files).
For creating/modifying files, use the 'edit' tool instead.
For git operations (status, diff, log), use the 'git' tool instead.`,
    parameters: {
      command: {
        type: 'string',
        description: 'Shell command to execute (required, non-empty string)',
        required: true,
      },
      description: {
        type: 'string',
        description:
          'Brief description (e.g. "Run unit tests"). Included in the output for traceability.',
      },
      timeout: {
        type: 'number',
        description:
          'Timeout in ms (100-600000, default: 120000). Increase for slow operations like npm install.',
      },
      cwd: {
        type: 'string',
        description:
          'Working directory path. Use when you need to run a command inside a subdirectory. Must exist.',
      },
    },
  },
  async execute(input): Promise<ToolResult> {
    // ── Step 1: Validate input ──────────────────────────────────────────
    const validated = validateInput(input)
    if (!validated.ok) {
      return { success: false, output: '', error: validated.error }
    }

    const { command, timeout, description, cwd } = validated

    // ── Step 2: Security check ──────────────────────────────────────────
    const destructiveHint = checkDestructive(command)
    if (destructiveHint) {
      return {
        success: false,
        output: '',
        error: `Destructive command blocked: ${destructiveHint}.\nUse the 'edit' tool for file modifications instead.\nIf you need to clean up temporary test artifacts, use a targeted approach:\n  - Remove a single file: del <filepath>\n  - Remove contents of a known-safe directory: Remove-Item \"<dir>\\*\" (without -Recurse on directories with subfolders)`,
      }
    }

    try {
      const { stdout, stderr, exitCode, timedOut } = await execCommand(command, timeout, cwd)

      // ── Step 3: Build output ──────────────────────────────────────────
      let output = ''
      if (description) {
        output += `[bash] ${description}\n`
      }

      // Redact sensitive data from output (API keys, tokens, passwords, etc.)
      const stdoutTrimmed = redactSensitive(stdout.trim())
      if (stdoutTrimmed) {
        output += stdoutTrimmed
      }

      let stderrTrimmed = redactSensitive(stderr.trim())

      // On Windows, PowerShell wraps native command stderr in ErrorRecord format
      // even when the command succeeds (exit code 0). Detect this and extract the
      // actual message content so it doesn't pollute output with "Command exited..." noise.
      if (exitCode === 0 && stderrTrimmed && os.platform() === 'win32') {
        const cleaned = extractPowerShellNativeOutput(stderrTrimmed)
        if (cleaned) {
          // Prepend a newline if there's already output
          output += (output ? '\n' : '') + cleaned
          stderrTrimmed = ''
        }
      }

      if (stderrTrimmed) {
        if (output) output += '\n'
        output += `(stderr):\n${stderrTrimmed}`
      }

      // Apply global truncation
      output = truncateOutput(output, MAX_OUTPUT_LENGTH, 'output')

      if (!output || output === (description ? `[bash] ${description}\n` : '')) {
        output = description ? `[bash] ${description}\n(no output)` : '(no output)'
      }

      if (timedOut) {
        return {
          success: false,
          output,
          error: buildErrorMsg(0, stderr, command, true, cwd),
        }
      }

      if (exitCode !== 0) {
        return {
          success: false,
          output,
          error: buildErrorMsg(exitCode, stderr, command, false, cwd),
        }
      }

      return { success: true, output }
    } catch (err) {
      const msg = fmtErr(err)
      return { success: false, output: '', error: `Command failed unexpectedly: ${msg}` }
    }
  },
}
