import { describe, expect, it } from 'vitest'
import { visibleLen } from '../utils.js'

describe('visibleLen', () => {
  it('returns 0 for empty string', () => {
    expect(visibleLen('')).toBe(0)
  })

  it('counts ASCII characters as width 1', () => {
    expect(visibleLen('hello')).toBe(5)
  })

  it('strips ANSI escape codes', () => {
    expect(visibleLen('\x1b[31mred\x1b[0m')).toBe(3)
    expect(visibleLen('\x1b[38;2;0;170;255mblue\x1b[0m')).toBe(4)
  })

  it('counts CJK characters as width 2', () => {
    expect(visibleLen('中文')).toBe(4)
    expect(visibleLen('你好世界')).toBe(8)
  })

  it('counts mixed ASCII and CJK correctly', () => {
    // "hello世界" = 5 + 4 = 9
    expect(visibleLen('hello世界')).toBe(9)
  })

  it('counts Korean characters as width 2', () => {
    expect(visibleLen('한글')).toBe(4)
  })

  it('handles ANSI-styled CJK text', () => {
    const styled = '\x1b[38;2;90;90;90m中文\x1b[0m'
    expect(visibleLen(styled)).toBe(4)
  })
})
