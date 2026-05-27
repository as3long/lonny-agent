import { execSync } from 'node:child_process'
import type { Tool, ToolDefinition } from './types.js'

export const createGitTool = (cwd: string): Tool => {
  const definition: ToolDefinition = {
    name: 'git',
    description:
      'Run git commands for repository operations. Supports status, diff, log, show, branch, and other read-only git operations.',
    parameters: {
      command: {
        type: 'string',
        description: 'Git subcommand and arguments (e.g. "status", "diff", "log --oneline -5")',
        required: true,
      },
      path: { type: 'string', description: 'Repository path (default: cwd)', required: false },
    },
  }

  const execute = async (
    input: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; error?: string }> => {
    const gitCmd = String(input.command || '').trim()
    const repoPath = String(input.path || cwd)

    if (!gitCmd) {
      return { success: false, output: '', error: 'command is required' }
    }

    // Safety: block destructive commands
    const destructivePatterns = [
      /^reset\s+(--hard|--soft|--mixed|--merge|--keep)/i,
      /^push\s+.*(--force|-f)/i,
      /^(rebase|merge|cherry-pick|revert)\b/i,
      /^branch\s+-[dD]/i,
      /^tag\s+-[dD]/i,
      /^(clean|gc|prune)\b/i,
      /^update-ref\b/i,
      /^rm\b/i,
      /^commit\s+--amend/i,
      /^checkout\s+.*-B/i,
    ]

    for (const pattern of destructivePatterns) {
      if (pattern.test(gitCmd)) {
        return {
          success: false,
          output: '',
          error: `Destructive git command not allowed: "${gitCmd}". Only read-only operations are permitted.`,
        }
      }
    }

    try {
      const result = execSync(`git ${gitCmd}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      })

      return { success: true, output: result.trim() || '(empty output)' }
    } catch (err) {
      const error = err as { stderr?: string; stdout?: string; message?: string }
      const stderr = error.stderr || ''
      const stdout = error.stdout || ''
      const msg = error.message || String(err)
      return {
        success: false,
        output: stdout.trim(),
        error: stderr.trim() || msg,
      }
    }
  }

  return { definition, execute }
}
