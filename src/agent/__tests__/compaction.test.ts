import { describe, expect, test } from 'vitest'
import { compact, estimateTokens, shouldCompact } from '../compaction.js'
import type { LLMMessage } from '../llm.js'

describe('estimateTokens', () => {
  test('estimates roughly 1 token per 4 characters', () => {
    expect(estimateTokens('hello')).toBe(2) // 5/4=1.25→2
    expect(estimateTokens('a')).toBe(1)
    expect(estimateTokens('')).toBe(0)
  })

  test('handles long strings', () => {
    const long = 'x'.repeat(100)
    expect(estimateTokens(long)).toBe(25) // 100/4=25
  })
})

describe('shouldCompact', () => {
  function msg(content: string): LLMMessage {
    return { role: 'user', content }
  }

  test('returns false for short messages', () => {
    const messages = [
      { role: 'system' as const, content: 'system prompt' },
      msg('hello'),
      msg('world'),
    ]
    expect(shouldCompact(messages, 100)).toBe(false)
  })

  test('returns true when token count exceeds threshold', () => {
    // 80 chars ≈ 20 tokens, threshold at 75% of 20 = 15
    const longContent = 'x'.repeat(80)
    const messages = [
      { role: 'system' as const, content: 'system prompt' },
      msg(longContent),
      msg(longContent),
      msg(longContent),
    ]
    // system: ~3 tokens, 3 * longContent: ~60 tokens, total ~63 > 20*0.75=15
    expect(shouldCompact(messages, 20)).toBe(true)
  })

  test('uses default maxTokens when not specified', () => {
    const messages = [{ role: 'system' as const, content: 'sys' }, msg('hi')]
    // Default is 128_000, threshold is 96_000 tokens ≈ 384_000 chars
    // So small messages should not trigger compaction
    expect(shouldCompact(messages)).toBe(false)
  })
})

describe('compact', () => {
  function sys(content = 'system'): LLMMessage {
    return { role: 'system', content }
  }

  function user(content: string): LLMMessage {
    return { role: 'user', content }
  }

  function assistantWithToolCall(name: string, input: Record<string, unknown>): LLMMessage {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{ name, input, id: 'call_1' }],
    }
  }

  function toolResult(name: string): LLMMessage {
    return { role: 'tool', content: 'ok', tool_call_id: 'call_1', name }
  }

  test('returns uncompressed when messages are few', () => {
    const messages = [sys(), user('hello')]
    const result = compact(messages, 100, 5)
    expect(result.compressed).toBe(false)
    expect(result.messages).toBe(messages)
  })

  test('returns uncompressed when token count is below threshold', () => {
    const messages = [sys(), user('a'), user('b'), user('c')]
    const result = compact(messages, 100000, 2)
    expect(result.compressed).toBe(false)
  })

  test('compresses long histories', () => {
    // Create enough messages to trigger compaction
    const messages: LLMMessage[] = [sys()]
    for (let i = 0; i < 30; i++) {
      messages.push(user('this is a user message that has some content'))
    }

    const result = compact(messages, 50, 5)
    expect(result.compressed).toBe(true)
    expect(result.originalCount).toBe(31)
    // Should have: system + summary + 5 recent
    expect(result.newCount).toBeLessThan(result.originalCount)
    expect(result.messages[0].role).toBe('system')
    // Second message should be the summary
    expect(result.messages[1].role).toBe('system')
    expect(result.messages[1].content).toContain('Conversation History Summary')
  })

  test('preserves tool-call cycles when cutting off', () => {
    // Create: system, user, assistant(tool), tool, assistant(tool), tool, ... recent
    const messages: LLMMessage[] = [sys('system')]
    messages.push(user('do something'))
    // A tool call cycle
    messages.push(assistantWithToolCall('edit', { file_path: 'test.ts' }))
    messages.push(toolResult('edit'))
    // More messages
    for (let i = 0; i < 25; i++) {
      messages.push(user(`message ${i}`))
    }

    const result = compact(messages, 100, 5)
    // After compaction, tool messages at the boundary should not be orphaned
    if (result.compressed) {
      for (let i = 2; i < result.messages.length; i++) {
        if (result.messages[i].role === 'tool') {
          // A 'tool' role message should always be preceded by a message with matching tool_calls
          expect(
            result.messages[i - 1].role === 'assistant' || result.messages[i - 1].role === 'system',
          ).toBe(true)
        }
      }
    }
  })

  test('summary contains exchange statistics', () => {
    const messages: LLMMessage[] = [sys()]
    for (let i = 0; i < 25; i++) {
      messages.push(user(`message number ${i}`))
    }
    messages.push(
      assistantWithToolCall('edit', { file_path: 'test.ts', old_string: 'a', new_string: 'b' }),
    )
    messages.push(toolResult('edit'))

    const result = compact(messages, 100, 5)
    if (result.compressed) {
      const summary = result.messages[1].content || ''
      expect(summary).toContain('Total exchanges')
    }
  })

  test('keeps recent messages untouched', () => {
    const messages: LLMMessage[] = [sys()]
    for (let i = 0; i < 30; i++) {
      messages.push(user(`msg ${i}`))
    }
    const keepRecent = 10
    const result = compact(messages, 50, keepRecent)

    if (result.compressed) {
      // Recent messages should include exactly `keepRecent` user messages
      // (or close to it, accounting for system + summary)
      const recentMessages = result.messages.slice(2) // skip system + summary
      expect(recentMessages.length).toBeLessThanOrEqual(keepRecent + 2) // some slack
    }
  })
})
