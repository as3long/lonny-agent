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

/**
 * Analyze the most recent messages to detect if delegation would be beneficial.
 * Returns a hint string if applicable, or empty string otherwise.
 */
function getDelegationHint(messages: LLMMessage[]): string {
  // Look at the last 3 assistant messages (with tool calls)
  let investigationCount = 0
  let editCount = 0
  let bashCount = 0
  let readCount = 0

  for (let i = messages.length - 1; i >= 0 && investigationCount + editCount < 6; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (
          tc.name === 'read' ||
          tc.name === 'grep' ||
          tc.name === 'glob' ||
          tc.name === 'ls' ||
          tc.name === 'find'
        ) {
          investigationCount++
          if (tc.name === 'read') readCount++
        } else if (tc.name === 'edit' || tc.name === 'write_plan') {
          editCount++
        } else if (tc.name === 'bash') {
          bashCount++
        }
      }
    }
  }

  // Suggest delegation if: significant investigation has been done,
  // edits haven't started yet, and there are well-bounded implementation tasks ahead
  if (investigationCount >= 3 && editCount === 0 && readCount >= 2) {
    return '\n\n💡 TIP: You have done significant investigation. For well-defined implementation subtasks, consider using `delegate` (via the `tool()` gateway) to spawn a sub-agent with minimal context. This keeps the main conversation focused and saves tokens.'
  }

  // If recent work was all in one area and there are other independent areas to work on
  if (bashCount >= 2 && editCount === 0) {
    return '\n\n💡 TIP: After you finish investigating, consider using `delegate` for implementing well-defined subtasks. The sub-agent gets a fresh, minimal context and reports back with a summary.'
  }

  return ''
}

export function getContinuationMessage(messages: LLMMessage[]): string {
  const firstUserMsg = messages.find(m => m.role === 'user')
  const taskHint =
    firstUserMsg && typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content.slice(0, 200)
      : 'the original task'

  const delegationHint = getDelegationHint(messages)

  return `[auto-continuation] The previous turn completed. Continue working on the original task: ${taskHint}

If you believe the task is complete, call the task_complete tool with a summary of what was accomplished to end the session. Otherwise, continue with the next steps.${delegationHint}`
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
        continue
      }
    }
    sanitized.push(msg)
  }
  return sanitized
}
