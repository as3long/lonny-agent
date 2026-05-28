import type { LLMMessage } from './llm.js'

/**
 * Context compaction — reduces long message histories while preserving
 * key context, inspired by pi's compaction system.
 */

const DEFAULT_MAX_TOKENS = 256_000
const COMPACTION_THRESHOLD = 0.75 // compact when usage exceeds 75% of budget

/** Rough token estimation (4 chars ~= 1 token).
 * NOTE: This is a very rough approximation. CJK characters (Chinese, Japanese,
 * Korean) can be 2-3 tokens each, and JSON/tool_call content is also denser.
 * For a 128K token budget, this may cause over- or under-compaction.
 * Consider using tiktoken or a similar tokenizer for better accuracy. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Estimate tokens in a message */
function messageTokens(m: LLMMessage): number {
  let total = 0
  total += estimateTokens(m.content || '')
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      total += estimateTokens(tc.name)
      total += estimateTokens(JSON.stringify(tc.input))
    }
  }
  return total
}

/** Estimate tokens in an array of messages */
export function estimateMessagesTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0)
}

export interface CompactionResult {
  messages: LLMMessage[]
  compressed: boolean
  originalCount: number
  newCount: number
}

/**
 * Check if compaction should be triggered.
 * Returns true if total estimated tokens exceed the threshold.
 */
export function shouldCompact(
  messages: LLMMessage[],
  maxTokens: number = DEFAULT_MAX_TOKENS,
): boolean {
  const total = estimateMessagesTokens(messages)
  return total > maxTokens * COMPACTION_THRESHOLD
}

/**
 * Compact a message list by summarizing older conversation turns.
 *
 * Strategy:
 * 1. Keep the system prompt (first message)
 * 2. Keep the most recent N messages (default 20) untouched
 * 3. Summarize older messages into a compact "history summary"
 * 4. Preserve tool call patterns for context
 */
export function compact(
  messages: LLMMessage[],
  maxTokens: number = DEFAULT_MAX_TOKENS,
  keepRecent: number = 20,
): CompactionResult {
  if (messages.length <= keepRecent + 1) {
    return {
      messages,
      compressed: false,
      originalCount: messages.length,
      newCount: messages.length,
    }
  }

  const totalTokens = estimateMessagesTokens(messages)
  if (totalTokens <= maxTokens * COMPACTION_THRESHOLD) {
    return {
      messages,
      compressed: false,
      originalCount: messages.length,
      newCount: messages.length,
    }
  }

  // Keep system prompt (index 0)
  const systemMsg = messages[0]

  // Find a safe cutoff — don't split tool-call cycles, which would orphan
  // tool role messages from their preceding assistant(tool_calls) message.
  let cutoff = messages.length - keepRecent
  if (cutoff < 1) cutoff = 1
  while (cutoff > 1 && messages[cutoff]?.role === 'tool') {
    cutoff--
  }

  const recentMessages = messages.slice(cutoff)
  const toSummarize = messages.slice(1, cutoff)

  if (toSummarize.length === 0) {
    return {
      messages,
      compressed: false,
      originalCount: messages.length,
      newCount: messages.length,
    }
  }

  // Build a summary of the older conversation
  const summary = buildSummary(toSummarize)

  // Reconstruct: system + summary + recent messages
  const compacted: LLMMessage[] = [
    systemMsg,
    { role: 'system', content: `[Conversation History Summary]\n${summary}` },
    ...recentMessages,
  ]

  return {
    messages: compacted,
    compressed: true,
    originalCount: messages.length,
    newCount: compacted.length,
  }
}

/**
 * Build a text summary of old messages.
 * Extracts key information: user requests, tool operations, file changes.
 */
function buildSummary(messages: LLMMessage[]): string {
  const parts: string[] = []
  let userCount = 0
  let toolCallCount = 0
  let editCount = 0
  const readFiles = new Set<string>()
  const bashCommands: string[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      userCount++
      const preview = (m.content || '').slice(0, 120)
      parts.push(`- User: ${preview}${(m.content || '').length > 120 ? '…' : ''}`)
    }
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        toolCallCount++
        if (tc.name === 'edit') {
          editCount++
          const paths = extractEditPaths(tc.input)
          parts.push(`- Edited: ${paths.join(', ')}`)
        } else if (tc.name === 'read') {
          const paths = tc.input.paths as string[] | undefined
          if (paths) paths.forEach(p => readFiles.add(p as string))
        } else if (tc.name === 'bash') {
          const cmd = tc.input.command as string | undefined
          if (cmd) bashCommands.push(cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd)
        }
      }
    }
  }

  const summary: string[] = []
  summary.push(`Total exchanges: ${userCount} user messages, ${toolCallCount} tool calls`)
  if (editCount > 0) summary.push(`Files edited: ${editCount} operations`)
  if (readFiles.size > 0) summary.push(`Files read: ${readFiles.size} unique files`)
  if (bashCommands.length > 0) {
    summary.push(
      `Commands executed: ${bashCommands.slice(0, 5).join(', ')}${bashCommands.length > 5 ? ` (+${bashCommands.length - 5} more)` : ''}`,
    )
  }

  return summary.join('\n')
}

function extractEditPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = []
  if (Array.isArray(input.edits)) {
    for (const e of input.edits) {
      if (typeof e === 'object' && e && 'file_path' in e) {
        paths.push(e.file_path as string)
      }
    }
  }
  return paths
}
