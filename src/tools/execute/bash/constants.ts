/** Maximum output length (chars) to prevent context overflow. */
export const MAX_OUTPUT_LENGTH = 10_000

/** Maximum stderr length included in error messages */
export const MAX_ERROR_LENGTH = 2_000

/** Maximum allowed timeout (10 minutes) */
export const MAX_TIMEOUT = 600_000

/** Minimum allowed timeout (100ms) */
export const MIN_TIMEOUT = 100

/** Default timeout (2 minutes) */
export const DEFAULT_TIMEOUT = 120_000

/**
 * Patterns that indicate a destructive command.
 * If matched, the tool will warn the user instead of executing.
 */
export const DESTRUCTIVE_PATTERNS: { regex: RegExp; hint: string }[] = [
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

/**
 * Patterns that match sensitive data (API keys, tokens, passwords, etc.)
 * in command output. Matching content is replaced with "[REDACTED]".
 */
export const SENSITIVE_PATTERNS: RegExp[] = [
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
