import { describe, it, expect } from 'vitest'
import { isDeepSeekOfficial } from '../balance.js'

describe('isDeepSeekOfficial', () => {
  it('returns true for official DeepSeek URL', () => {
    expect(isDeepSeekOfficial('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekOfficial('https://api.deepseek.com/v1')).toBe(true)
  })

  it('returns false for other URLs', () => {
    expect(isDeepSeekOfficial('https://api.openai.com')).toBe(false)
    expect(isDeepSeekOfficial('https://generativelanguage.googleapis.com')).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isDeepSeekOfficial(undefined)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isDeepSeekOfficial('')).toBe(false)
  })

  it('handles URL with path correctly', () => {
    expect(isDeepSeekOfficial('https://api.deepseek.com/v1/chat')).toBe(true)
  })
})
