import * as os from 'node:os'

import { MAX_ERROR_LENGTH } from './constants.js'
import { redactSensitive } from './security.js'

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

/**
 * Check if stderr contains PowerShell NativeCommandError wrapping.
 * This happens when a native command (like git push) writes to stderr and
 * PowerShell wraps the output in an ErrorRecord format even though the
 * command exited successfully (exit code 0).
 *
 * Example format:
 *   git : Everything up-to-date
 *   At line:1 char:1
 *   + git push 2>&1
 *   + ~~~~~~~~~~~~~
 *       + CategoryInfo          : NotSpecified: (...) [], RemoteException
 *       + FullyQualifiedErrorId : NativeCommandError
 *
 * Returns the extracted actual output if detected, null otherwise.
 */
function extractPowerShellNativeOutput(stderr: string): string | null {
  // Detect PowerShell ErrorRecord wrapping around native command stderr output.
  // The key marker is "FullyQualifiedErrorId : NativeCommandError".
  if (!/FullyQualifiedErrorId\s*:\s*NativeCommandError/i.test(stderr)) {
    return null
  }

  const lines = stderr.split(/\r?\n/)
  const outputLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    // Skip PowerShell error record wrapper lines:
    //   "   + CategoryInfo          : ..."  (indented, with +)
    //   "   + FullyQualifiedErrorId : ..."
    //   "At line:1 char:1" or Chinese garbled equivalent
    //   "+ command ..." (the command echo line with leading +)
    //   "  + ~~~~~~~~~~~~~" (the caret underline)
    if (
      /^\s*\+/.test(trimmed) ||
      /^At\s+line:\d+/i.test(trimmed) ||
      /^\+?\s*CategoryInfo/i.test(trimmed) ||
      /^\+?\s*FullyQualifiedErrorId/i.test(trimmed)
    ) {
      continue
    }

    // Skip blank lines within the error record block (but keep leading whitespace for formatting)
    if (!trimmed && outputLines.length > 0) {
      continue
    }

    // Remove leading whitespace from the first content line (the "<command> : <message>" line)
    outputLines.push(line)
  }

  const result = outputLines.join('\n').trim()
  return result || null
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

export {
  buildErrorMsg,
  checkCommandNotFound,
  checkPowerShellError,
  extractPowerShellNativeOutput,
  truncateOutput,
}
