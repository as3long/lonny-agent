import { exec } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Tool, ToolDefinition } from '../types.js'

/** Normalize a git command string — strip common LLM mistakes. */
function normalizeGitCommand(raw: string): string {
  let cmd = String(raw).trim()
  // LLM often writes `git("git status")` or `git("git status --short")`
  cmd = cmd.replace(/^git\s+/, '')
  // Strip leading `git(` or `git'` artifacts from LLM hallucination
  cmd = cmd.replace(/^git['"(]\s*/, '').replace(/['")]\s*$/, '')
  return cmd
}

/** Common corrections map for git subcommand typos. */
const COMMON_TYPOS: Record<string, string> = {
  stauts: 'status',
  staus: 'status',
  statsu: 'status',
  comit: 'commit',
  commmit: 'commit',
  brach: 'branch',
  branc: 'branch',
  chekout: 'checkout',
  checkut: 'checkout',
  'diff --staged': 'diff --cached',
  'diff --stage': 'diff --cached',
}

/** Suggest a fix for a failed git command based on stderr content. */
function suggestFix(cmd: string, stderr: string): string | null {
  const lower = stderr.toLowerCase()
  if (lower.includes('not a git repository') || lower.includes('not a git repo')) {
    return 'Not a git repository. Check that you are in the correct directory.'
  }
  if (lower.includes('did not match any file(s) known to git')) {
    return 'The path does not match any tracked files. Use `git status` to see tracked files first.'
  }
  if (lower.includes('pathspec') && lower.includes('did not match')) {
    return 'The pathspec did not match. Check the file path is correct and tracked by git.'
  }
  if (lower.includes('unknown option') || lower.includes('usage:')) {
    return 'Unknown flag or syntax error. Check `git help` for the correct usage.'
  }
  if (lower.includes('ambiguous argument')) {
    return 'Ambiguous argument. Try quoting the path or using `--` to separate options from paths.'
  }
  if (lower.includes('permission denied') || lower.includes('denied')) {
    return 'Permission denied. You may not have access to this repository.'
  }
  return null
}

export const createGitTool = (cwd: string): Tool => {
  const definition: ToolDefinition = {
    name: 'git',
    category: 'Execute',
    group: 'Git',
    description: `Run git commands for repository operations.

COMMON USE CASES:
  git({ command: "status" })             # Working tree status
  git({ command: "diff" })               # Unstaged changes
  git({ command: "diff --cached" })      # Staged changes
  git({ command: "log --oneline -5" })   # Recent commits
  git({ command: "show <hash>" })        # Show a specific commit
  git({ command: "branch" })             # List branches
  git({ command: "branch -a" })          # List all branches (including remote)
  git({ command: "commit -m \"msg\"" })  # Commit staged changes (allowed, read-only-only mode)
  git({ command: "add ." })              # Stage all changes (allowed)

NOTES:
  - Omit the "git" prefix — just pass the subcommand.
  - Use \`cwd\` to run in a subdirectory of the repo.
  - On Windows, \`commit\` automatically gets \`--no-verify\` appended to bypass pre-commit hooks.`,
    parameters: {
      command: {
        type: 'string',
        description:
          'Git subcommand and arguments (e.g. "status", "diff", "log --oneline -5"). Do NOT include the "git " prefix.',
        required: true,
      },
      path: {
        type: 'string',
        description: 'Repository path (alias: cwd). Defaults to working directory.',
        required: false,
      },
      cwd: {
        type: 'string',
        description: 'Working directory (alias: path). Defaults to working directory.',
        required: false,
      },
    },
  }

  const execute = async (
    input: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; error?: string }> => {
    let gitCmd = normalizeGitCommand(String(input.command || ''))

    // Accept both `path` and `cwd` parameters (LLM convention)
    const repoPath = String(input.path || input.cwd || cwd)

    if (!gitCmd) {
      return {
        success: false,
        output: '',
        error:
          'command is required. Use: git({ command: "status" }) — pass the subcommand without the "git " prefix.',
      }
    }

    // Auto-correct common typos in the first subcommand word
    const firstWord = gitCmd.split(/\s+/)[0]!
    if (firstWord && COMMON_TYPOS[firstWord]) {
      gitCmd = gitCmd.replace(firstWord, COMMON_TYPOS[firstWord]!)
    }

    // Safety: block destructive commands (checked AFTER normalization)
    const destructivePatterns = [
      /^push\b/i,
      /^reset\s+(--hard|--soft|--mixed|--merge|--keep)/i,
      /^(rebase|merge|cherry-pick|revert)\b/i,
      /^branch\s+-[dD]/i,
      /^branch\s+--delete\b/i,
      /^tag\s+-[dD]/i,
      /^(clean|gc|prune)\b/i,
      /^update-ref\b/i,
      /^rm\b/i,
      /^checkout\b/i,
      /^fetch\s+.*--force/i,
      /^stash\s+(drop|clear)\b/i,
      /^config\b/i,
    ]

    // Auto-add --no-verify on Windows for git commit to bypass pre-commit hooks
    // (Husky/lint-staged hooks often fail on Windows due to CRLF warnings in PowerShell)
    if (os.platform() === 'win32' && /^commit\b/i.test(gitCmd) && !/--no-verify/.test(gitCmd)) {
      gitCmd = gitCmd.replace(/^commit\b/i, 'commit --no-verify')
    }

    for (const pattern of destructivePatterns) {
      if (pattern.test(gitCmd)) {
        return {
          success: false,
          output: '',
          error: `Destructive git command not allowed: "${gitCmd}". Only read-only operations are permitted. If you need to make changes, use the \`edit\` tool for file modifications and git add/commit for staging.`,
        }
      }
    }

    // Verify the repo path exists
    if (!fs.existsSync(repoPath)) {
      return {
        success: false,
        output: '',
        error: `Repository path does not exist: "${repoPath}". Use a valid directory path.`,
      }
    }
    if (!fs.statSync(repoPath).isDirectory()) {
      return {
        success: false,
        output: '',
        error: `Repository path is not a directory: "${repoPath}".`,
      }
    }

    return new Promise(resolve => {
      const child = exec(
        `git ${gitCmd}`,
        {
          cwd: repoPath,
          encoding: 'utf-8',
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024, // 10MB
        },
        (err, stdout, stderr) => {
          if (err) {
            const exitCode = typeof err.code === 'number' ? err.code : -1
            const stderrMsg = stderr?.trim() || ''
            const stdoutMsg = stdout?.trim() || ''

            // git diff exits with 1 when there are differences — that's not an error
            if ((gitCmd.startsWith('diff') || gitCmd.startsWith('status')) && stdoutMsg) {
              return resolve({ success: true, output: stdoutMsg })
            }

            let errorMsg = stderrMsg || err.message || String(err)
            const hint = suggestFix(gitCmd, errorMsg)
            if (hint) errorMsg += `\n💡 ${hint}`

            return resolve({
              success: exitCode === 0 && stdoutMsg ? true : false,
              output: stdoutMsg,
              error: errorMsg,
            })
          }

          const output = (stdout || '').trim() || '(empty output)'
          return resolve({ success: true, output })
        },
      )

      // Handle spawn error (e.g. git not installed)
      child.on('error', spawnErr => {
        return resolve({
          success: false,
          output: '',
          error: `Failed to run git: ${spawnErr.message}. Ensure git is installed and in your PATH.`,
        })
      })
    })
  }

  return { definition, execute }
}
