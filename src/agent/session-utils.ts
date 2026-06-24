import type { ToolCall, ToolResult } from '../tools/types.js'
import type { LLMMessage } from './llm.js'

/**
 * Compress a tool result for storage in message history.
 * Keeps essential context while dramatically reducing token usage.
 * The LLM saw the full output during streaming — this is for future turns
 * where only key facts matter. The LLM can re-read files if needed later.
 * Extracted to a shared utility so both the main agent and sub-agents use it.
 */
export function compressToolResult(tc: ToolCall, result: ToolResult): string {
  if (!result.success) {
    return `ERROR: ${result.error || tc.name}`
  }
  const output = result.output

  if (tc.name === 'read') {
    // Parse file headers from read output
    const lines = output.split('\n')
    const fileHeaders: string[] = []
    let totalLines = 0
    let inHeader = false
    for (const line of lines) {
      if (line.startsWith('===')) {
        const fp = line.slice(4, line.includes(' ===') ? line.indexOf(' ===') : undefined)
        fileHeaders.push(fp ? fp.trim() : line)
        inHeader = true
        // Check for pagination info: (lines X-Y of Z)
        const pageMatch = line.match(/\(lines (\d+)-(\d+) of \d+\)/)
        if (pageMatch) {
          totalLines += parseInt(pageMatch[2]!, 10) - parseInt(pageMatch[1]!, 10) + 1
        }
      } else if (line.trim() && inHeader) {
        // Count non-empty content lines
        totalLines++
      } else if (!line.startsWith('===')) {
        // Non-header, non-content (e.g. error line)
        if (line.trim()) totalLines++
      }
    }
    if (fileHeaders.length === 0) {
      // Fallback: keep as-is but capped
      return output.length <= 500
        ? output
        : `[read result] ${output.slice(0, 300)}…\n[truncated: ${output.length} total chars]`
    }
    // Compress: just file paths + line counts
    return `[read result] ${fileHeaders.length} file(s): ${fileHeaders.join(', ')} (${totalLines} total lines shown)`
  }

  if (tc.name === 'bash') {
    const lines = output.split('\n')
    if (lines.length <= 20 && output.length <= 800) {
      return output // Keep short outputs as-is
    }
    const description = lines[0]?.startsWith('[bash]') ? lines[0] : ''
    const body = description ? lines.slice(1).join('\n') : output
    const head = body.slice(0, 300)
    const tail = body.length > 500 ? body.slice(-200) : ''
    let compressed = description ? `${description}\n` : ''
    compressed += head
    if (tail) {
      compressed += `\n… [truncated: ${body.length} total chars, showing first 300 + last 200]\n`
      compressed += tail
    }
    return compressed
  }

  if (tc.name === 'grep') {
    const matchLines = output.split('\n').filter(l => l.trim() && !l.startsWith('No match'))
    if (matchLines.length <= 25 && output.length <= 1000) {
      return output
    }
    return (
      matchLines.slice(0, 25).join('\n') +
      (matchLines.length > 25 ? `\n… [${matchLines.length - 25} more matches suppressed]` : '')
    )
  }

  if (tc.name === 'glob') {
    const files = output.split('\n').filter(l => l.trim() && !l.startsWith('No'))
    if (files.length <= 50 && output.length <= 500) {
      return output
    }
    return (
      files.slice(0, 30).join('\n') +
      (files.length > 30 ? `\n… [${files.length - 30} more files suppressed]` : '')
    )
  }

  if (tc.name === 'edit') {
    // Already compressed by the tool, but clean up ANSI codes
    const clean = output.replace(/\x1b\[[0-9;]*m/g, '')
    if (clean.length <= 500) return clean
    return `${clean.slice(0, 400)}\n… [truncated: ${clean.length} total chars]`
  }

  // task_complete: always keep full summary (it's a concise accomplishment record)
  if (tc.name === 'task_complete') {
    return output
  }

  // Default: keep as-is but cap at 1000 chars
  if (output.length <= 1000) return output
  return `${output.slice(0, 700)}\n… [truncated: ${output.length} total chars]`
}

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

/**
 * Count recent tool calls to give the LLM a sense of progress.
 */
function countRecentOps(messages: LLMMessage[]): { reads: number; edits: number; bash: number } {
  let reads = 0
  let edits = 0
  let bash = 0
  // Look at the last 10 assistant messages
  let count = 0
  for (let i = messages.length - 1; i >= 0 && count < 10; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.tool_calls) {
      count++
      for (const tc of m.tool_calls) {
        if (tc.name === 'read' || tc.name === 'grep' || tc.name === 'glob') reads++
        else if (tc.name === 'edit') edits++
        else if (tc.name === 'bash') bash++
      }
    }
  }
  return { reads, edits, bash }
}

export function getContinuationMessage(messages: LLMMessage[]): string {
  const firstUserMsg = messages.find(m => m.role === 'user')
  const taskHint =
    firstUserMsg && typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content.slice(0, 100)
      : 'the original task'

  const delegationHint = getDelegationHint(messages)
  const { reads, edits, bash } = countRecentOps(messages)

  // Build a compact progress line (only if there was activity)
  const progressParts: string[] = []
  if (edits > 0) progressParts.push(`${edits} edits`)
  if (reads > 0) progressParts.push(`${reads} reads`)
  if (bash > 0) progressParts.push(`${bash} cmds`)
  const progress = progressParts.length > 0 ? ` [recent: ${progressParts.join(', ')}]` : ''

  return `[auto-continuation] Continue: ${taskHint}.${progress}
End by calling task_complete when done.${delegationHint}`
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
