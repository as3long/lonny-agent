import type { ChildProcess } from 'node:child_process'
import { execSync, spawn } from 'node:child_process'
import * as os from 'node:os'

import { fmtErr } from '../../errors.js'
import { MAX_ERROR_LENGTH, MAX_OUTPUT_LENGTH } from './constants.js'
import { ENCODING } from './platform.js'

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

/**
 * Kill a child process tree reliably across platforms.
 * - On Windows: uses `taskkill /F /T` for force-kill of the process tree when possible.
 * - On Unix: sends SIGTERM first, then SIGKILL after a grace period.
 * - Handles missing pid and protects against thrown errors.
 */
function killProcess(child: ChildProcess): NodeJS.Timeout | undefined {
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

function execCommand(command: string, timeout: number, cwd?: string): Promise<ExecResult> {
  return new Promise(resolve => {
    const isWindows = os.platform() === 'win32'
    const shellExe = isWindows ? 'powershell.exe' : process.env.SHELL || '/bin/sh'
    const shellArgs = isWindows
      ? ['-NoProfile', '-NonInteractive', '-Command', command]
      : ['-c', command]

    // Protect against spawn throwing synchronously (e.g. missing shell)
    let child: ChildProcess | undefined
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

export type { ExecResult }
export { execCommand, killProcess }
