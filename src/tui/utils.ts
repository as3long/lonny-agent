/**
 * Calculate the visible width of a string, accounting for ANSI escape codes
 * and CJK double-width characters.
 */
export function visibleLen(s: string): number {
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '')
  let len = 0
  for (const ch of stripped) {
    const code = ch.charCodeAt(0)
    if (
      code >= 0x1100 &&
      (code <= 0x115f ||
        code === 0x2329 ||
        code === 0x232a ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        code >= 0x1f004)
    ) {
      len += 2
    } else {
      len += 1
    }
  }
  return len
}
