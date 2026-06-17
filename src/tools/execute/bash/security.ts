import { DESTRUCTIVE_PATTERNS, SENSITIVE_PATTERNS } from './constants.js'

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

export { checkDestructive, redactSensitive }
