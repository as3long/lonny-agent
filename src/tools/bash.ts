import { execSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum output length (chars) to prevent context overflow. */
const MAX_OUTPUT_LENGTH = 10_000

/** Maximum stderr length included in error messages */
const MAX_ERROR_LENGTH = 2_000

/** Maximum allowed timeout (10 minutes) */
const MAX_TIMEOUT = 600_000

/** Minimum allowed timeout (100ms) */
const MIN_TIMEOUT = 100

/** Default timeout (2 minutes) */
const DEFAULT_TIMEOUT = 120_000

/**
 * Patterns that indicate a destructive command.
 * If matched, the tool will warn the user instead of executing.
 */
const DESTRUCTIVE_PATTERNS: { regex: RegExp; hint: string }[] = [
  // ═══════════════════════
  // Unix destructive
  // ═══════════════════════
  { regex: /\brm\s+-(?:rf|fr)\s+\/$/i, hint: 'rm -rf / would destroy the system' },
  { regex: /\brm\s+-(?:rf|fr)\s+\/\*/i, hint: 'rm -rf /* would destroy the system' },
  { regex: /\brm\s+-(?:rf|fr)\s+~$/i, hint: 'rm -rf ~ would delete the home directory' },
  { regex: /\b(?:mkfs|dd)\s+(?:\/dev|\\.)/i, hint: 'mkfs/dd would destroy a disk device' },
  { regex: /\bchmod\s+-R\s+0{4}\b/, hint: 'chmod -R 0000 would make files inaccessible' },
  {
    regex: /\b(?:shutdown|reboot|halt|poweroff)\s+(?:-h|-r|-now|now)\b/i,
    hint: 'shutdown/reboot would halt the system',
  },
  {
    regex: /\b(?:killall|pkill)\s+-9\s+/i,
    hint: 'killall -9 would terminate all matching processes',
  },
  // ═══════════════════════
  // Windows destructive
  // ═══════════════════════
  {
    regex: /\b(?:Remove-Item|rmdir|rd)\s+.*(?:-Recurse|-R)\s+.*(?:-Force|-F)\b/i,
    hint: 'recursive force delete would destroy data',
  },
  {
    regex: /\b(?:Remove-Item|rmdir|rd)\s+\w:\s*[\\/]/i,
    hint: 'recursive delete on drive root would destroy data',
  },
  {
    regex: /\b(?:del|erase)\s+.*(?:\/F|\/S)\b/i,
    hint: 'force delete would destroy files irreversibly',
  },
  { regex: /\bformat\s+\w:\s*\/[Qq]/i, hint: 'format would destroy a drive' },
  { regex: /\b(?:diskpart|clean-all)\b/i, hint: 'diskpart clean-all would destroy all partitions' },
  { regex: /\bClear-Item\s+/i, hint: 'Clear-Item would delete content irreversibly' },
  { regex: /\bClear-Content\s+/i, hint: 'Clear-Content would delete file content irreversibly' },
  { regex: /\bRemove-ItemProperty\s+/i, hint: 'Remove-ItemProperty would delete registry keys' },
  { regex: /\bRemove-Variable\s+-Force\b/i, hint: 'Remove-Variable -Force would delete variables' },
  { regex: /\breg\s+delete\s+/i, hint: 'reg delete would destroy registry entries' },
  { regex: /\bwmic\s+\w+\s+delete\b/i, hint: 'wmic delete would destroy system resources' },
  { regex: /\b(?:cipher|sdelete)\s+\/w:/i, hint: 'secure delete would irreversibly wipe data' },
  {
    regex: /\[System\.IO\.Directory\]::Delete\s*\(/i,
    hint: 'Directory.Delete would destroy data irreversibly',
  },
  {
    regex: /\[System\.IO\.File\]::Delete\s*\(/i,
    hint: 'File.Delete would destroy data irreversibly',
  },
]

// ── Platform detection ───────────────────────────────────────────────────────

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

// ── Input validation ─────────────────────────────────────────────────────────

/**
 * Validate the raw input object and return a cleaned input or an error message.
 * Returns { ok: true, ... } or { ok: false, error: string }.
 */
interface ValidatedInput {
  ok: true
  command: string
  timeout: number
  description: string
  cwd: string | undefined
}
interface InputError {
  ok: false
  error: string
}
type ValidateResult = ValidatedInput | InputError

function validateInput(input: Record<string, unknown>): ValidateResult {
  // command: must be a non-empty string
  const command = input.command
  if (command === undefined || command === null) {
    return { ok: false, error: 'command is required' }
  }
  if (typeof command !== 'string') {
    return { ok: false, error: `command must be a string, got ${typeof command}` }
  }
  if (command.trim() === '') {
    return { ok: false, error: 'command must not be empty or whitespace-only' }
  }

  // timeout: must be a number (or default), within bounds
  let timeout = DEFAULT_TIMEOUT
  if (input.timeout !== undefined) {
    if (
      typeof input.timeout === 'number' &&
      !Number.isNaN(input.timeout) &&
      Number.isFinite(input.timeout)
    ) {
      timeout = Math.round(input.timeout)
      if (timeout < MIN_TIMEOUT) {
        timeout = MIN_TIMEOUT
      } else if (timeout > MAX_TIMEOUT) {
        timeout = MAX_TIMEOUT
      }
    }
    // If timeout is not a valid number, silently use default
  }

  // description: optional string
  const description = typeof input.description === 'string' ? input.description : ''

  // cwd: optional string, must be a valid directory, no path traversal
  let cwd: string | undefined
  if (typeof input.cwd === 'string' && input.cwd.trim()) {
    const rawCwd = input.cwd.trim()
    // Path traversal protection
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rawCwd)) {
      return {
        ok: false,
        error: `cwd contains path traversal (..) which is not allowed: "${rawCwd}"`,
      }
    }
    const resolvedCwd = path.resolve(rawCwd)
    if (!fs.existsSync(resolvedCwd)) {
      return { ok: false, error: `cwd directory does not exist: "${resolvedCwd}"` }
    }
    if (!fs.statSync(resolvedCwd).isDirectory()) {
      return { ok: false, error: `cwd is not a directory: "${resolvedCwd}"` }
    }
    cwd = resolvedCwd
  }

  return { ok: true, command: command.trim(), timeout, description, cwd }
}

// ── Security check ───────────────────────────────────────────────────────────

/**
 * Check if a command matches destructive patterns.
 * Returns a warning string if detected, null otherwise.
 */
function checkDestructive(command: string): string | null {
  for (const { regex, hint } of DESTRUCTIVE_PATTERNS) {
    if (regex.test(command)) {
      return hint
    }
  }
  return null
}

// ── Encoding detection (Windows) ─────────────────────────────────────────────

/**
 * Detect Windows console code page to handle non-UTF-8 output correctly.
 * Falls back to 'utf-8' if detection fails.
 * On non-Windows platforms, always returns 'utf-8'.
 */
function detectEncoding(): string {
  if (os.platform() !== 'win32') return 'utf-8'
  try {
    const result = execSync('[Console]::OutputEncoding.CodePage', {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2000,
      windowsHide: true,
      encoding: 'utf-8',
      shell: 'powershell.exe',
    })
    const cp = Number.parseInt(result.toString().trim(), 10)
    // Common Windows code pages that need special handling
    if (cp === 936) return 'gbk' // Chinese (Simplified)
    if (cp === 950) return 'big5' // Chinese (Traditional)
    if (cp === 932) return 'shift-jis' // Japanese
    if (cp === 949) return 'euc-kr' // Korean
    if (
      cp === 1250 ||
      cp === 1251 ||
      cp === 1252 ||
      cp === 1253 ||
      cp === 1254 ||
      cp === 1255 ||
      cp === 1256 ||
      cp === 1257
    ) {
      return `cp${cp}` // Windows code page
    }
    return 'utf-8'
  } catch {
    return 'utf-8'
  }
}

// Cache encoding detection once at startup
const ENCODING = detectEncoding()

// ── Process killing ──────────────────────────────────────────────────────────

/**
 * Kill a child process tree reliably across platforms.
 * - On Windows: uses `taskkill /F /T` for force-kill of the process tree when possible.
 * - On Unix: sends SIGTERM first, then SIGKILL after a grace period.
 * - Handles missing pid and protects against thrown errors.
 */
function killProcess(child: import('node:child_process').ChildProcess): NodeJS.Timeout | undefined {
  try {
    if (!child || typeof (child as any).pid !== 'number' || Number.isNaN((child as any).pid)) {
      // Best-effort kill if pid is not available
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      return undefined
    }

    if (os.platform() === 'win32') {
      try {
        // Use taskkill to terminate the whole process tree. If it fails, fall back to child.kill().
        execSync(`taskkill /F /T /PID ${child.pid}`, {
          stdio: 'ignore',
          timeout: 3000,
        })
      } catch {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
      return undefined
    } else {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      // Track timer so we can force-KILL after a grace period
      const killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already exited or cannot kill */
        }
      }, 5000)
      // Ensure we clean up the timer and the listener when the child exits
      const onExit = () => {
        try {
          clearTimeout(killTimer)
        } catch {
          /* ignore */
        }
        try {
          child.removeListener('exit', onExit)
        } catch {
          /* ignore */
        }
      }
      child.on('exit', onExit)
      return killTimer
    }
  } catch {
    return undefined
  }
}

// ── Command execution ────────────────────────────────────────────────────────

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

function execCommand(command: string, timeout: number, cwd?: string): Promise<ExecResult> {
  return new Promise(resolve => {
    const isWindows = os.platform() === 'win32'
    const shellExe = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/sh'
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command]

    // Protect against spawn throwing synchronously (e.g. missing shell)
    let child: import('node:child_process').ChildProcess | undefined
    try {
      child = spawn(shellExe, shellArgs, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        windowsHide: true,
      })
    } catch (err) {
      // Return a normalized error result rather than throwing
      resolve({ stdout: '', stderr: fmtErr(err), exitCode: 1, timedOut: false })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false

    // Keep memory bounded by limiting how much we accumulate for each stream
    const MAX_STDOUT_BUFFER = Math.max(MAX_OUTPUT_LENGTH * 2, 20000)
    const MAX_STDERR_BUFFER = Math.max(MAX_ERROR_LENGTH * 2, 4000)
    let stdoutTruncated = false
    let stderrTruncated = false

    // Track which encodings work for each stream (per-chunk fallback).
    let stdoutEncoding: string | undefined
    let stderrEncoding: string | undefined

    let treeKillTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      timedOut = true
      // Attempt to kill the process tree; capture any returned timer so we can clear it on close
      treeKillTimer = killProcess(child!)
    }, timeout)

    child!.stdout?.on('data', (data: Buffer) => {
      if (stdout.length >= MAX_STDOUT_BUFFER) {
        stdoutTruncated = true
        return
      }
      try {
        const enc = stdoutEncoding || ENCODING
        stdout += data.toString(enc as BufferEncoding)
        stdoutEncoding = enc
      } catch {
        // Detected encoding failed; fall back to utf-8
        try {
          stdout += data.toString('utf-8')
          stdoutEncoding = 'utf-8'
        } catch {
          // Give up on this chunk
        }
      }
    })

    child!.stderr?.on('data', (data: Buffer) => {
      if (stderr.length >= MAX_STDERR_BUFFER) {
        stderrTruncated = true
        return
      }
      try {
        const enc = stderrEncoding || ENCODING
        stderr += data.toString(enc as BufferEncoding)
        stderrEncoding = enc
      } catch {
        try {
          stderr += data.toString('utf-8')
          stderrEncoding = 'utf-8'
        } catch {
          // ignore
        }
      }
    })

    const finish = (code: number | null) => {
      try {
        clearTimeout(timer)
      } catch {
        /* ignore */
      }
      if (treeKillTimer) {
        try {
          clearTimeout(treeKillTimer)
        } catch {
          /* ignore */
        }
      }

      // If we truncated during streaming, append a short notice so final output can indicate truncation
      if (stdoutTruncated) stdout += '\n... [stdout truncated due to size limit]'
      if (stderrTruncated) stderr += '\n... [stderr truncated due to size limit]'

      resolve({ stdout, stderr, exitCode: code ?? 0, timedOut })
    }

    child!.on('close', code => finish(code))

    child!.on('error', err => {
      try {
        clearTimeout(timer)
      } catch {
        /* ignore */
      }
      if (treeKillTimer) {
        try {
          clearTimeout(treeKillTimer)
        } catch {
          /* ignore */
        }
      }
      // Include the spawn error message in stderr so callers can surface it
      const errMsg = fmtErr(err)
      if (errMsg) stderr += (stderr ? '\n' : '') + errMsg
      resolve({ stdout, stderr, exitCode: 1, timedOut })
    })
  })
}

// ── Output helpers ───────────────────────────────────────────────────────────

/**
 * Truncate a string to maxLength chars. If truncated, appends a warning.
 * Returns the (possibly truncated) string.
 */
function truncateOutput(s: string, maxLength: number, label: string): string {
  if (s.length <= maxLength) return s
  const truncated = s.slice(0, maxLength)
  const warning = `\n... [${label} truncated at ${maxLength} chars, original ${s.length} chars]`
  return truncated + warning
}

// ── Sensitive data redaction ────────────────────────────────────────────

/**
 * Patterns that match sensitive data (API keys, tokens, passwords, etc.)
 * in command output. Matching content is replaced with "[REDACTED]".
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Generic API keys / tokens
  /(?:api[_-]?key|apikey|token|secret|password|passwd|credential|auth[_-]?token)[=:]\s*['"]?[A-Za-z0-9_\-.]{16,}/gi,
  // AWS keys
  /(?:AKIA[0-9A-Z]{16}|[A-Za-z0-9+/]{40}\s*=[=]{0,2})/g,
  // GitHub tokens
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  // npm tokens
  /npm_[A-Za-z0-9]{36,}/g,
  // Slack tokens
  /xox[baprs]-[A-Za-z0-9-]{24,}/g,
  // SSH private key content (multi-line)
  /-----BEGIN[ A-Z]+PRIVATE KEY-----[\s\S]*?-----END[ A-Z]+PRIVATE KEY-----/g,
  // JWT tokens
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // Generic password-like strings in env vars
  /export\s+\w*(?:PASS|SECRET|TOKEN|KEY)\w*\s*=\s*['"]?\S+['"]?/gi,
  /\$env:\w*(?:PASS|SECRET|TOKEN|KEY)\w*\s*=\s*['"]?\S+['"]?/gi,
]

/**
 * Redact sensitive data from a string by replacing matches with "[REDACTED]".
 * Returns the redacted string.
 */
function redactSensitive(s: string): string {
  let result = s
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}

/**
 * Check if stderr indicates common PowerShell errors and return a helpful message.
 * Returns a tip string if detected, null otherwise.
 */
function checkPowerShellError(stderr: string, command: string): string | null {
  const errLower = stderr.toLowerCase()

  // Execution policy errors
  if (/execution.?policy/i.test(errLower) || /running scripts is disabled/i.test(errLower)) {
    return 'PowerShell execution policy is blocking this command. Try: `powershell -ExecutionPolicy Bypass -Command "..."`'
  }

  // Module not found
  if (
    /module.*not (found|available)/i.test(errLower) ||
    /could not (find|load).*module/i.test(errLower)
  ) {
    const moduleMatch = stderr.match(/module\s+['"]?(\w+)['"]?/i)
    const moduleName = moduleMatch ? moduleMatch[1]! : '<unknown>'
    return `PowerShell module not found: "${moduleName}". Install it with: Install-Module ${moduleName} -Force`
  }

  // Cmdlet not found
  if (/the term '(\w+)' is not recognized/i.test(errLower)) {
    const cmdMatch = stderr.match(/the term '(\w+)'/i)
    const cmdName = cmdMatch ? cmdMatch[1]! : command.split(/\s+/)[0] || command
    return `Cmdlet not found: "${cmdName}". This command may need a module or be installed separately.`
  }

  // Access denied
  if (
    /access is denied/i.test(errLower) ||
    /permission denied/i.test(errLower) ||
    /unauthorized/i.test(errLower)
  ) {
    return 'Access denied. Try running as Administrator (on Windows) or using sudo (on Unix).'
  }

  // Path not found
  if (/cannot find (path|drive)/i.test(errLower) || /path.*does not exist/i.test(errLower)) {
    return 'The specified path or drive was not found. Check that the path exists and is accessible.'
  }

  return null
}

/**
 * Check if stderr output indicates a "command not found" error.
 * Returns a platform-appropriate suggestion if detected, null otherwise.
 */
function checkCommandNotFound(stderr: string, command: string): string | null {
  const isWindows = os.platform() === 'win32'
  const errLower = stderr.toLowerCase()

  if (isWindows) {
    // PowerShell "not recognized" patterns
    if (
      /not recognized/.test(errLower) ||
      /is not recognized/.test(errLower) ||
      /找不到/.test(errLower) ||
      /command not found/.test(errLower) ||
      /not found/.test(errLower) ||
      /neither the command nor/.test(errLower)
    ) {
      // Extract the command name that wasn't found (first word of the command)
      const cmdName = command.split(/\s+/)[0] || command
      return `Command not found: "${cmdName}". It may be a Unix command not available on Windows. Use "where" to find available commands or use PowerShell-native alternatives.`
    }
  } else {
    // Unix "not found" patterns
    if (
      /not found/.test(errLower) ||
      /command not found/.test(errLower) ||
      /no such file/.test(errLower)
    ) {
      const cmdName = command.split(/\s+/)[0] || command
      return `Command not found: "${cmdName}". Check that it is installed, or use "which ${cmdName}" to find its location.`
    }
  }
  return null
}

/**
 * Build a helpful error message for a failed command, including
 * platform-specific suggestions when applicable.
 */
function buildErrorMsg(
  exitCode: number,
  stderr: string,
  command: string,
  timedOut: boolean,
  cwd?: string,
): string {
  const parts: string[] = []

  if (timedOut) {
    parts.push(`Command timed out (exit code ${exitCode})`)
  } else {
    parts.push(`Command exited with code ${exitCode}`)
  }

  // Check for "command not found" first (before including full stderr)
  const notFoundMsg = checkCommandNotFound(stderr, command)
  if (notFoundMsg) {
    parts.push(notFoundMsg)
  }

  // Check for common PowerShell errors
  if (os.platform() === 'win32') {
    const psErrMsg = checkPowerShellError(stderr, command)
    if (psErrMsg) {
      parts.push(psErrMsg)
    }
  }

  // Include stderr content (truncated and redacted)
  const stderrTrimmed = stderr.trim()
  if (stderrTrimmed) {
    const redactedStderr = redactSensitive(stderrTrimmed)
    parts.push(`stderr:\n${truncateOutput(redactedStderr, MAX_ERROR_LENGTH, 'stderr')}`)
  }

  // Platform-specific suggestions for common mistakes
  const isWindows = os.platform() === 'win32'

  if (isWindows) {
    // Common Windows command mistakes
    if (/ls\b/.test(command) && !/ls\b/.test(command.replace(/".*"/g, ''))) {
      parts.push('💡 Tip: On Windows, use `dir` instead of `ls`, or `Get-ChildItem` in PowerShell.')
    }
    if (/grep\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `findstr` or `Select-String` instead of `grep`.')
    }
    if (/touch\b/.test(command)) {
      parts.push(
        '💡 Tip: On Windows, `touch` is not available. Use `New-Item` or `edit` tool to create files.',
      )
    }
    if (/ps\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Get-Process` instead of `ps` for listing processes.')
    }
    if (/pwd\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Get-Location` or `$pwd` instead of `pwd`.')
    }
    if (
      /chmod\b/.test(command) ||
      /cp\b/.test(command) ||
      /mv\b/.test(command) ||
      /rm\b/.test(command) ||
      /mkdir\b/.test(command)
    ) {
      parts.push(
        '💡 Tip: On Windows, use native equivalents: `copy`, `move`, `del`, `mkdir`, `icacls` instead of Unix commands.',
      )
    }
    if (/cat\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `type` or `Get-Content` instead of `cat`.')
    }
    if (/which\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `where` instead of `which` to find executable locations.')
    }
    if (/less\b/.test(command) || /more\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `more` or `Out-Host -Paging` for paging output.')
    }
    if (/sort\b/.test(command) && !/sort-object/i.test(command) && !/Sort-Object/i.test(command)) {
      parts.push('💡 Tip: On Windows, use `Sort-Object` instead of `sort`.')
    }
    if (/head\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Select-Object -First` instead of `head`.')
    }
    if (/tail\b/.test(command)) {
      parts.push(
        '💡 Tip: On Windows, use `Get-Content -Tail` or `Select-Object -Last` instead of `tail`.',
      )
    }
    if (/diff\b/.test(command) || /cmp\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Compare-Object` instead of `diff`/`cmp`.')
    }
    if (/curl\b/.test(command) && !/curl\b/.test(command.replace(/".*"/g, ''))) {
      parts.push(
        '💡 Tip: On Windows, use `Invoke-WebRequest` or `Invoke-RestMethod` instead of `curl`. curl is available in newer Windows builds.',
      )
    }
    if (/wget\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Invoke-WebRequest` instead of `wget`.')
    }
    if (/env\b/.test(command)) {
      parts.push('💡 Tip: On Windows, use `Get-ChildItem Env:` to list environment variables.')
    }
    if (/kill\b/.test(command) && !/stop-process/i.test(command)) {
      parts.push('💡 Tip: On Windows, use `Stop-Process` or `taskkill` instead of `kill`.')
    }
  } else {
    // Unix-specific tips
    if (/dir\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `ls -la` instead of `dir`.')
    }
    if (/findstr\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `grep` instead of `findstr`.')
    }
    if (/type\b/.test(command) && !/type\b/.test(command.replace(/".*"/g, ''))) {
      parts.push('💡 Tip: On Unix, use `cat` instead of `type`.')
    }
    if (/where\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `which` instead of `where` to find executable locations.')
    }
    if (/copy\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `cp` instead of `copy`.')
    }
    if (/move\b/.test(command) || /ren\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `mv` instead of `move`/`ren`.')
    }
    if (/del\b/.test(command)) {
      parts.push('💡 Tip: On Unix, use `rm` instead of `del`.')
    }
  }

  if (cwd) {
    parts.push(`Working directory: ${cwd}`)
  }

  return parts.join('\n')
}

// ── Tool definition ──────────────────────────────────────────────────────────

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
        error: `Destructive command blocked: ${destructiveHint}.\nUse the 'edit' tool for file modifications instead.`,
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

      const stderrTrimmed = redactSensitive(stderr.trim())
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
