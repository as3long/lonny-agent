import { Box, Static, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kChatContent, kConfig } from '../context.js'
import { highlightLine } from '../highlight.js'
import { colors } from './colors.js'
import { TokenStats } from './token-stats.js'
import { ToolInvocation } from './tool-invocation.js'
import { ToolResult } from './tool-result.js'
import { UserMessage } from './user-message.js'

const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
const thinkBlockRegex = /\[THINK\]\n([\s\S]*?)\n\[\/THINK\]/g

type Part =
  | { type: 'text'; content: string; lang?: string }
  | { type: 'code'; lang?: string; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'user'; content: string }
  | { type: 'tool'; name: string; status: string; summary: string; details: string[] }
  | { type: 'tool_call'; name: string; icon: string; detail: string }
  | { type: 'token_stats'; text: string }

function formatContent(text: string): Part[] {
  const parts: Part[] = []
  let lastIndex = 0

  // Split by all known block types
  const combinedRegex =
    /```(\w*)\n([\s\S]*?)```|\[THINK\]\n([\s\S]*?)\n\[\/THINK\]|\[USER\]\n([\s\S]*?)\n\[\/USER\]|\[TOOL\s+(\w+)\s+(OK|ERROR)\]([\s\S]*?)\[\/TOOL\]|\[TOOL_CALL\s+(\w+)\s+(.)\]([\s\S]*?)\[\/TOOL_CALL\]|\[TOKEN_STATS\]\n([\s\S]*?)\n\[\/TOKEN_STATS\]/g
  let match: RegExpExecArray | null = combinedRegex.exec(text)

  while (match !== null) {
    // Text before this match
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index)
      if (before.trim()) {
        parts.push({ type: 'text', content: before })
      }
    }

    if (match[1] !== undefined) {
      // Code block: group 1 = lang, group 2 = content
      parts.push({ type: 'code', lang: match[1], content: match[2] })
    } else if (match[3] !== undefined) {
      // Thinking block: group 3 = content
      parts.push({ type: 'thinking', content: match[3].trim() })
    } else if (match[4] !== undefined) {
      // User message block: group 4 = content
      parts.push({ type: 'user', content: match[4].trim() })
    } else if (match[5] !== undefined) {
      // Tool result block: group 5 = name, group 6 = status, group 7 = body
      const body = match[7].trim()
      const bodyLines = body
        .split('\n')
        .map(l => l.trim())
        .filter(l => l)
      const summary = bodyLines[0] || ''
      const details = bodyLines.slice(1)
      parts.push({ type: 'tool', name: match[5], status: match[6], summary, details })
    } else if (match[8] !== undefined) {
      // Tool invocation block: group 8 = name, group 9 = icon, group 10 = detail
      const detail = match[10].trim()
      parts.push({ type: 'tool_call', name: match[8], icon: match[9], detail })
    } else {
      // Token stats block: group 11 = text
      parts.push({ type: 'token_stats', text: match[11].trim() })
    }

    lastIndex = match.index + match[0].length
    match = combinedRegex.exec(text)
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex)
    if (rest.trim()) {
      parts.push({ type: 'text', content: rest })
    }
  }

  return parts
}

export const ChatMessages = defineComponent({
  setup() {
    const chatContent = inject(kChatContent)!
    const config = inject(kConfig)!

    const modelName = config.model

    return () => {
      const text = chatContent.value
      if (!text) return h(Box, { flexGrow: 1 })

      const parts = formatContent(text)

      const children = parts.map((part, i) => {
        if (part.type === 'code') {
          const lines = part.content.split('\n')
          const highlighted = lines
            .map(line => {
              if (part.lang) {
                return highlightLine(line, part.lang) || line
              }
              return line
            })
            .join('\n')

          return h(
            Box,
            {
              key: i,
              borderStyle: 'round',
              borderColor: colors.dim,
              paddingX: 1,
              marginY: 1,
            },
            [h(Text, { color: '#c8c8c8' }, highlighted)],
          )
        }
        if (part.type === 'user') {
          return h(UserMessage, { key: i, content: part.content })
        }
        if (part.type === 'tool') {
          return h(ToolResult, {
            key: i,
            name: part.name,
            status: part.status,
            summary: part.summary,
            details: part.details,
          })
        }
        if (part.type === 'thinking') {
          return h(
            Box,
            {
              key: i,
              borderStyle: 'round',
              borderColor: colors.dim,
              paddingX: 1,
              marginY: 1,
            },
            [h(Text, { color: '#9696a0' }, part.content)],
          )
        }
        if (part.type === 'tool_call') {
          return h(ToolInvocation, {
            key: i,
            name: part.name,
            icon: part.icon,
            detail: part.detail,
          })
        }
        if (part.type === 'token_stats') {
          return h(TokenStats, { key: i, text: part.text })
        }
        return h(Text, { key: i, color: '#d4d4d4' }, part.content)
      })

      return h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 1, minHeight: 0 }, children)
    }
  },
})
