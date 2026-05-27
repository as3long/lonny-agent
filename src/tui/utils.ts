/**
 * Calculate the visible width of a string, accounting for ANSI escape codes
 * and CJK double-width characters.
 */
export function visibleLen(s: string): number {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '')
  let len = 0
  for (const ch of stripped) {
    const code = ch.charCodeAt(0)
    if (code >= 0x1100 && (
        code <= 0x115F ||
        code === 0x2329 || code === 0x232A ||
        (code >= 0x2E80 && code <= 0xA4CF && code !== 0x303F) ||
        (code >= 0xAC00 && code <= 0xD7A3) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFE10 && code <= 0xFE19) ||
        (code >= 0xFE30 && code <= 0xFE6F) ||
        (code >= 0xFF00 && code <= 0xFF60) ||
        (code >= 0xFFE0 && code <= 0xFFE6) ||
        (code >= 0x1F004)
    )) {
      len += 2
    } else {
      len += 1
    }
  }
  return len
}
