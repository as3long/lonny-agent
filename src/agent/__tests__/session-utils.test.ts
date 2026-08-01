import { describe, expect, test } from 'vitest'
import type { LLMMessage } from '../llm.js'
import {
  compressToolResult,
  getContinuationMessage,
  isTaskCompleteMessage,
} from '../session-utils.js'

function msg(role: LLMMessage['role'], overrides?: Partial<LLMMessage>): LLMMessage {
  return { role, content: '', ...overrides }
}

let callId = 0
function toolCall(name: string) {
  callId++
  return { id: `tc${callId}`, name, input: {} }
}

describe('getContinuationMessage', () => {
  test('includes the original task hint', () => {
    const messages: LLMMessage[] = [
      msg('system', { content: 'system prompt' }),
      msg('user', { content: 'Fix the bug in login.ts' }),
    ]
    const result = getContinuationMessage(messages)
    expect(result).toContain('Fix the bug in login.ts')
  })

  test('does NOT include delegation hint for simple conversation', () => {
    const messages: LLMMessage[] = [
      msg('system', { content: 'sys' }),
      msg('user', { content: 'hello' }),
      msg('assistant', { content: 'hi there' }),
    ]
    const result = getContinuationMessage(messages)
    expect(result).not.toContain('delegate')
  })

  test('includes delegation hint after heavy investigation', () => {
    const messages: LLMMessage[] = [
      msg('system', { content: 'sys' }),
      msg('user', { content: 'Implement the sort function in utils.ts' }),
      msg('assistant', {
        content: null,
        tool_calls: [toolCall('read'), toolCall('glob')],
      }),
      msg('tool', { content: 'file content...', tool_call_id: 'tc1', name: 'read' }),
      msg('tool', { content: 'files found...', tool_call_id: 'tc2', name: 'glob' }),
      msg('assistant', {
        content: null,
        tool_calls: [toolCall('read'), toolCall('grep')],
      }),
      msg('tool', { content: 'more file content...', tool_call_id: 'tc3', name: 'read' }),
      msg('tool', { content: 'search results...', tool_call_id: 'tc4', name: 'grep' }),
    ]
    const result = getContinuationMessage(messages)
    expect(result).toContain('delegate')
    expect(result).toContain('sub-agent')
  })

  test('does NOT include delegation hint when edits already started', () => {
    const messages: LLMMessage[] = [
      msg('system', { content: 'sys' }),
      msg('user', { content: 'Implement feature' }),
      msg('assistant', {
        content: null,
        tool_calls: [toolCall('read'), toolCall('edit')],
      }),
      msg('tool', { content: 'file content...', tool_call_id: 'tc1', name: 'read' }),
      msg('tool', { content: 'edit applied', tool_call_id: 'tc2', name: 'edit' }),
    ]
    const result = getContinuationMessage(messages)
    expect(result).not.toContain('delegate')
  })
})

describe('isTaskCompleteMessage', () => {
  test('detects "task complete" phrases', () => {
    expect(isTaskCompleteMessage('The task is complete.')).toBe(true)
    expect(isTaskCompleteMessage('All tasks complete')).toBe(true)
    expect(isTaskCompleteMessage('task_complete')).toBe(true)
    expect(isTaskCompleteMessage('任务完成')).toBe(true)
  })

  test('returns false for non-completion messages', () => {
    expect(isTaskCompleteMessage('Working on the task')).toBe(false)
    expect(isTaskCompleteMessage('')).toBe(false)
  })

  test('is case insensitive', () => {
    expect(isTaskCompleteMessage('TASK COMPLETE')).toBe(true)
    expect(isTaskCompleteMessage('Task Complete')).toBe(true)
  })
})

describe('compressToolResult', () => {
  test('read: keeps small outputs as-is', () => {
    const output = '=== a.ts === (lines 1-5 of 5)\nline1\nline2\nline3'
    expect(compressToolResult(toolCall('read'), { success: true, output })).toBe(output)
  })

  test('read: keeps content preview for large outputs', () => {
    const body = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(50)}`).join('\n')
    const output = `=== big.ts === (lines 1-100 of 100)\n${body}`
    const result = compressToolResult(toolCall('read'), { success: true, output })
    expect(result).toContain('=== big.ts ===')
    expect(result).toContain('line 0 ')
    expect(result).toContain('line 79 ')
    expect(result).not.toContain('line 99 ')
    expect(result).toContain('[read summary: 1 file(s), 200 content lines total]')
  })

  test('read: keeps a preview for each file in multi-file output', () => {
    const body = Array.from({ length: 100 }, (_, i) => `a${i} ${'x'.repeat(50)}`).join('\n')
    const output = `=== a.ts === (lines 1-100 of 100)\n${body}\n\n=== b.ts === (lines 1-100 of 100)\n${body}`
    const result = compressToolResult(toolCall('read'), { success: true, output })
    expect(result).toContain('=== a.ts ===')
    expect(result).toContain('=== b.ts ===')
    expect(result).toContain('[read summary: 2 file(s), 400 content lines total]')
  })

  test('read: error results return an ERROR prefix', () => {
    const result = compressToolResult(toolCall('read'), { success: false, error: 'boom' })
    expect(result).toBe('ERROR: boom')
  })

  test('read: output without headers falls back to capped text', () => {
    const output = 'x'.repeat(600)
    const result = compressToolResult(toolCall('read'), { success: true, output })
    expect(result).toContain('[read result]')
    expect(result).toContain('[truncated: 600 total chars]')
  })
})
