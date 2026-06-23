import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import type { Tool, ToolDefinition, ToolResult } from '../types.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum stdout length before truncation (prevents context overflow). */
const MAX_OUTPUT_LENGTH = 50_000

/** Maximum stderr length for error messages. */
const MAX_STDERR_LENGTH = 5_000

/** Default git command timeout (60s). */
const GIT_TIMEOUT = 60_000

/** maxBuffer for execFile — large enough for big diffs. */
const MAX_BUFFER = 100 * 1024 * 1024 // 100MB

// ── Arg parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a command string into an argv array, handling quoted strings.
 * This lets us use execFile (no shell) while accepting a command string from the LLM.
 */
function parseArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let isEscape = false

  for (let i = 0; i < input.length; i++) {
    const c = input[i]

    if (isEscape) {
      current += c
      isEscape = false
      continue
    }

    if (c === '\\' && inDouble) {
      isEscape = true
      continue
    }

    if (c === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (c === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (c === ' ' && !inSingle && !inDouble) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    current += c
  }

  if (current) args.push(current)
  return args
}

// ── Command normalization ────────────────────────────────────────────────────

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
  sttaus: 'status',
  comit: 'commit',
  commmit: 'commit',
  commint: 'commit',
  brach: 'branch',
  branc: 'branch',
  branh: 'branch',
  chekout: 'checkout',
  checkut: 'checkout',
  checout: 'checkout',
  'diff --staged': 'diff --cached',
  'diff --stage': 'diff --cached',
  logg: 'log',
  sho: 'show',
  shw: 'show',
  'git st': 'status',
  'git di': 'diff',
  'git lo': 'log',
}

/** Suggest a fix for a failed git command based on stderr content. */
function suggestFix(_cmd: string, stderr: string): string | null {
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
  if (lower.includes('could not read')) {
    return 'Git could not read the requested data. Check that the ref or path is correct.'
  }
  if (lower.includes('bad revision')) {
    return 'Bad revision. The commit hash or ref you specified does not exist.'
  }
  if (lower.includes('no such file')) {
    return 'No such file or directory. Check that the path exists.'
  }
  if (lower.includes('not something we can merge')) {
    return 'Not a valid commit or reference to merge. Check the branch name or commit hash.'
  }
  return null
}

/**
 * Truncate a string if it exceeds maxLength, appending a truncation notice.
 * Tries to break at a newline near the boundary.
 */
function truncateOutput(s: string, maxLength: number, label: string): string {
  if (s.length <= maxLength) return s
  // Try to break at a newline near the boundary
  const breakAt = s.lastIndexOf('\n', maxLength)
  const cut = breakAt > maxLength * 0.8 ? breakAt : maxLength
  const warning = `\n... [${label} truncated at ${cut} chars, original ${s.length} chars]`
  return s.slice(0, cut) + warning
}

// ── Destructive command patterns ─────────────────────────────────────────────

/** Patterns for git commands that mutate repo state (blocked). */
const DESTRUCTIVE_PATTERNS: RegExp[] = [
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

/** Env overrides for every git invocation — prevents hangs and color codes. */
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0', // Never prompt for credentials
  GIT_PAGER: 'cat', // Never use interactive pager
  PAGER: 'cat', // Fallback for older git versions
  GIT_FLUSH: '0', // Disable flushing to avoid hangs
}

// ── Tool factory ─────────────────────────────────────────────────────────────

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
  git({ command: "add ." })              # Stage all changes
  git({ command: 'commit -m "msg"' })  # Commit staged changes

NOTES:
  - Omit the "git" prefix — just pass the subcommand (e.g. "status" not "git status").
  - Use \`cwd\` to run in a subdirectory of the repo.
  - On Windows, \`commit\` automatically gets \`--no-verify\` appended.
  - Large output is automatically truncated to avoid context overflow.`,
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

  const execute = async (input: Record<string, unknown>): Promise<ToolResult> => {
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

    // ── Typo auto-correction ────────────────────────────────────────────
    const firstWord = gitCmd.split(/\s+/)[0]!
    if (firstWord && COMMON_TYPOS[firstWord]) {
      gitCmd = gitCmd.replace(firstWord, COMMON_TYPOS[firstWord]!)
    }

    // ── Auto-add --no-verify on Windows for git commit ──────────────────
    if (os.platform() === 'win32' && /^commit\b/i.test(gitCmd) && !/--no-verify/.test(gitCmd)) {
      gitCmd = gitCmd.replace(/^commit\b/i, 'commit --no-verify')
    }

    // ── Destructive command check ───────────────────────────────────────
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(gitCmd)) {
        return {
          success: false,
          output: '',
          error: `Destructive git command not allowed: "${gitCmd}". Only read-only operations are permitted. If you need to make changes, use the \`edit\` tool for file modifications and git add/commit for staging.`,
        }
      }
    }

    // ── Repo path validation ────────────────────────────────────────────
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

    // ── Build argv for execFile ─────────────────────────────────────────
    // Prepend git config flags that ensure clean, reliable output
    const gitArgs: string[] = [
      '-c',
      'color.ui=never', // No ANSI escape codes
      '-c',
      'core.pager=cat', // Never page output
      '-c',
      'core.quotePath=false', // Show non-ASCII filenames directly
      '--literal-pathspecs', // Disable glob expansion in pathspecs
      ...parseArgs(gitCmd),
    ]

    // ── Execute via execFile (no shell) ─────────────────────────────────
    return new Promise(resolve => {
      const child = execFile(
        'git',
        gitArgs,
        {
          cwd: repoPath,
          env: GIT_ENV,
          encoding: 'utf-8',
          timeout: GIT_TIMEOUT,
          maxBuffer: MAX_BUFFER,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          if (err) {
            const exitCode = typeof err.code === 'number' ? err.code : -1
            const stdoutMsg = stdout?.trim() || ''
            const stderrMsg = stderr?.trim() || ''

            // git diff/status exits with 1 when there are differences — not an error
            if (
              (gitCmd.startsWith('diff') || gitCmd.startsWith('status')) &&
              stdoutMsg &&
              exitCode === 1
            ) {
              const output = truncateOutput(stdoutMsg, MAX_OUTPUT_LENGTH, 'output')
              return resolve({ success: true, output })
            }

            let errorMsg = stderrMsg || err.message || String(err)
            const hint = suggestFix(gitCmd, errorMsg)
            if (hint) errorMsg += `\n💡 ${hint}`

            errorMsg = truncateOutput(errorMsg, MAX_STDERR_LENGTH, 'error')

            return resolve({
              success: exitCode === 0,
              output: stdoutMsg || '',
              error: errorMsg,
            })
          }

          let output = (stdout || '').trim()
          if (!output) output = '(empty output)'
          output = truncateOutput(output, MAX_OUTPUT_LENGTH, 'output')
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
