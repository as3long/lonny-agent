import * as fs from 'node:fs'
import * as path from 'node:path'

import { DEFAULT_TIMEOUT, MAX_TIMEOUT, MIN_TIMEOUT } from './constants.js'

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

export type { InputError, ValidatedInput, ValidateResult }
export { validateInput }
