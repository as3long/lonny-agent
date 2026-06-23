import { eastAsianWidthType } from 'get-east-asian-width'
import type { LLMMessage } from './llm.js'

/**
 * Context compaction — reduces long message histories while preserving
 * key context, inspired by pi's compaction system.
 */

const DEFAULT_MAX_TOKENS = 256_000

/**
 * 获取默认的上下文窗口大小（保持向后兼容）
 * @deprecated 请使用 config.contextWindow 代替
 */
export const DEFAULT_CONTEXT_WINDOW = DEFAULT_MAX_TOKENS
const COMPACTION_THRESHOLD = 0.75 // compact when usage exceeds 75% of budget

// Token density multipliers
// Wide (CJK) characters: 1 char ≈ 2 tokens (conservative; actual can be 2-3)
// Narrow (ASCII) characters: 4 chars ≈ 1 token
const WIDE_TOKENS_PER_CHAR = 2
const NARROW_CHARS_PER_TOKEN = 4

/**
 * Estimate the number of tokens in a text string.
 *
 * Uses `get-east-asian-width` to distinguish narrow (ASCII) from
 * wide (CJK / fullwidth) characters, which have different token densities.
 * This is still a heuristic — for exact counts, use the API's reported usage.
 */
export function estimateTokens(text: string): number {
  let wide = 0
  let narrow = 0
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)
    if (cp === undefined) continue
    // BMP characters are single code unit; non-BMP take two
    if (cp > 0xffff) i++
    if (eastAsianWidthType(cp) === 'wide') {
      wide++
    } else {
      narrow++
    }
  }
  return wide * WIDE_TOKENS_PER_CHAR + Math.ceil(narrow / NARROW_CHARS_PER_TOKEN)
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

  // Reconstruct: system + recent messages + summary (appended at end so
  // the sys+recent prefix stays stable for LLM prompt caching)
  const compacted: LLMMessage[] = [
    systemMsg,
    ...recentMessages,
    { role: 'system', content: `[Conversation History Summary]\n${summary}` },
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
 * Produces a structured summary with:
 * - What was accomplished (key file edits and their purpose)
 * - Key design decisions extracted from user/assistant messages
 * - Test outcomes
 * - Current progress / remaining tasks
 */
function buildSummary(messages: LLMMessage[]): string {
  // ── Collect structured data ────────────────────────────────────────────
  const userMessages: string[] = []
  const editedFiles = new Map<string, string[]>() // file -> new_string snippets
  const readFiles = new Set<string>()
  const bashCommands: string[] = []
  const testResults: string[] = []
  const toolCallCounts: Record<string, number> = {}
  let totalToolCalls = 0

  for (const m of messages) {
    if (m.role === 'user' && m.content) {
      const text = typeof m.content === 'string' ? m.content : ''
      // Skip auto-continuation messages (they're boilerplate)
      if (text.startsWith('[auto-continuation]')) continue
      userMessages.push(text)
    }

    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        totalToolCalls++
        const name = tc.name
        toolCallCounts[name] = (toolCallCounts[name] || 0) + 1

        if (name === 'edit') {
          // Extract file paths and what was added (new_string snippets)
          const edits = (tc.input as Record<string, unknown>).edits as
            | Record<string, unknown>[]
            | undefined
          if (edits) {
            for (const e of edits) {
              const fp = e.file_path as string | undefined
              if (fp) {
                const newStr = (e.new_string as string) || ''
                // Extract function/class/interface names from new_string
                const symbols = extractSymbols(newStr)
                const existing = editedFiles.get(fp) || []
                if (symbols.length > 0) {
                  existing.push(...symbols)
                } else {
                  // Fallback: show first meaningful line
                  const firstLine = newStr.split('\n')[0]?.trim().slice(0, 80)
                  if (firstLine) existing.push(firstLine)
                }
                editedFiles.set(fp, [...new Set(existing)])
              }
            }
          } else {
            // Direct format: { file_path, new_string }
            const fp = tc.input.file_path as string | undefined
            if (fp) {
              const newStr = (tc.input.new_string as string) || ''
              const symbols = extractSymbols(newStr)
              const existing = editedFiles.get(fp) || []
              if (symbols.length > 0) {
                existing.push(...symbols)
              } else {
                const firstLine = newStr.split('\n')[0]?.trim().slice(0, 80)
                if (firstLine) existing.push(firstLine)
              }
              editedFiles.set(fp, [...new Set(existing)])
            }
          }
        } else if (name === 'read') {
          const paths = tc.input.paths as string[] | undefined
          if (paths) paths.forEach(p => readFiles.add(p as string))
        } else if (name === 'bash') {
          const cmd = tc.input.command as string | undefined
          if (cmd) bashCommands.push(cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd)
        }
      }
    }

    // Check tool result messages for test outcomes
    if (m.role === 'tool' && m.content && typeof m.content === 'string') {
      const content = m.content
      // Detect test run results
      if (
        content.includes('PASS') ||
        content.includes('FAIL') ||
        content.includes('Tests:') ||
        content.includes('test file') ||
        content.includes('✓') ||
        content.includes('×')
      ) {
        // Extract the test summary line
        const lines = content.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (
            trimmed.startsWith('Tests:') ||
            trimmed.startsWith('Test Files:') ||
            trimmed.startsWith('✓') ||
            trimmed.startsWith('×') ||
            trimmed.startsWith('PASS') ||
            trimmed.startsWith('FAIL')
          ) {
            testResults.push(trimmed.slice(0, 120))
          }
        }
      }
    }
  }

  // ── Build structured summary ───────────────────────────────────────────
  const sections: string[] = []

  // Section: User requests (key ones only, deduplicated)
  if (userMessages.length > 0) {
    // Only keep the most important user messages (first + last few)
    const shown: string[] = []
    if (userMessages.length <= 3) {
      for (const msg of userMessages) shown.push(`- ${msg.slice(0, 200)}`)
    } else {
      // First message + last 2
      shown.push(`- [initial] ${userMessages[0].slice(0, 200)}`)
      for (const msg of userMessages.slice(-2)) {
        shown.push(`- ${msg.slice(0, 200)}`)
      }
      if (userMessages.length > 3) {
        shown.push(`- … (${userMessages.length - 3} more user messages in between)`)
      }
    }
    sections.push(`## User Requests\n${shown.join('\n')}`)
  }

  // Section: Changes made (files edited and what was added/modified)
  if (editedFiles.size > 0) {
    const changeLines: string[] = []
    for (const [fp, symbols] of editedFiles) {
      if (symbols.length > 0) {
        changeLines.push(
          `- ${fp}: ${symbols.slice(0, 3).join(', ')}${symbols.length > 3 ? ` (+${symbols.length - 3} more)` : ''}`,
        )
      } else {
        changeLines.push(`- ${fp}: modified`)
      }
    }
    sections.push(`## Changes Made\n${changeLines.join('\n')}`)
  }

  // Section: Test outcomes
  if (testResults.length > 0) {
    const unique = [...new Set(testResults)]
    sections.push('## Test Results\n' + unique.join('\n'))
  }

  // Section: Tool usage summary (compact)
  const toolSummary = Object.entries(toolCallCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}(${count})`)
    .join(', ')
  const readSummary = readFiles.size > 0 ? `, read ${readFiles.size} files` : ''
  const bashSummary =
    bashCommands.length > 0
      ? `, ${bashCommands.length} bash cmds (${bashCommands.slice(0, 3).join('; ')}${bashCommands.length > 3 ? '…' : ''})`
      : ''

  sections.push(
    '## Activity\n' + `${totalToolCalls} tool calls: ${toolSummary}${readSummary}${bashSummary}`,
  )

  return sections.join('\n\n')
}

/**
 * Extract meaningful symbol names (function/class/interface/variable declarations)
 * from a code snippet. Returns up to 3 meaningful names.
 */
function extractSymbols(code: string): string[] {
  const symbols: string[] = []

  // Match function/class/interface/type/enum/const/let/var declarations
  const patterns = [
    /\bexport\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/g,
    /\b(?:async\s+)?function\s+(\w+)/g,
    /\b(?:export\s+)?(?:default\s+)?class\s+(\w+)/g,
    /\b(?:export\s+)?interface\s+(\w+)/g,
    /\b(?:export\s+)?type\s+(\w+)\s*=/g,
    /\b(?:export\s+)?enum\s+(\w+)/g,
    /\b(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::|=[^=])/g,
    /\bimport\s+\{\s*(\w+)/g,
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1]
      if (name && name !== 'default' && !symbols.includes(name)) {
        symbols.push(name)
        if (symbols.length >= 5) return symbols
      }
    }
  }

  return symbols
}
