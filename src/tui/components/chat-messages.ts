import { Box, Static, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kChatContent, kConfig } from '../context.js'
import { highlightLine } from '../highlight.js'
import { colors } from './colors.js'

const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
const thinkBlockRegex = /\[THINK\]\n([\s\S]*?)\n\[\/THINK\]/g

type Part = { type: 'text' | 'code' | 'thinking'; lang?: string; content: string }

function formatContent(text: string): Part[] {
  const parts: Part[] = []
  let lastIndex = 0

  // Split by both code blocks and thinking blocks simultaneously
  const combinedRegex = /```(\w*)\n([\s\S]*?)```|\[THINK\]\n([\s\S]*?)\n\[\/THINK\]/g
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
      parts.push({ type: 'code', lang: match[1] || undefined, content: match[2] })
    } else {
      // Thinking block: group 3 = content
      parts.push({ type: 'thinking', content: match[3].trim() })
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
        return h(Text, { key: i, color: '#d4d4d4' }, part.content)
      })

      return h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 1 }, children)
    }
  },
})
