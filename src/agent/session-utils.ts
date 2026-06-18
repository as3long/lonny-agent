import type { LLMMessage } from './llm.js'

export function isTaskCompleteMessage(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const patterns = [
    'task complete',
    'task_complete',
    'task is complete',
    'all tasks complete',
    '任务完成',
    '任务已完成',
    '全部完成',
    '没有更多任务',
    '无需继续',
  ]
  return patterns.some(p => lower.includes(p))
}

export function getContinuationMessage(messages: LLMMessage[]): string {
  const firstUserMsg = messages.find(m => m.role === 'user')
  const taskHint =
    firstUserMsg && typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content.slice(0, 200)
      : 'the original task'
  return `[auto-continuation] The previous turn completed. Continue working on the original task: ${taskHint}

If you believe the task is complete, call the task_complete tool with a summary of what was accomplished to end the session. Otherwise, continue with the next steps.`
}

export function sanitizeMessages(messages: LLMMessage[]): LLMMessage[] {
  const sanitized: LLMMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const pendingIds = new Set(msg.tool_calls.map(tc => tc.id))
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool' && pendingIds.size > 0) {
        const toolMsg = messages[j]
        if (toolMsg.tool_call_id && pendingIds.has(toolMsg.tool_call_id)) {
          pendingIds.delete(toolMsg.tool_call_id)
        }
        j++
      }
      if (pendingIds.size > 0) {
        const dropped = msg.tool_calls.map(tc => `${tc.name}(${tc.id})`).join(', ')
        console.warn(`[session] Dropping assistant message with unfulfilled tool_calls: ${dropped}`)
        continue
      }
    }
    sanitized.push(msg)
  }
  return sanitized
}
