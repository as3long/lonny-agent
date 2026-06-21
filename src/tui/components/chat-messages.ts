import { Box, Static, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kChatContent, kConfig } from '../context.js'
import { highlightLine } from '../highlight.js'
import { colors } from './colors.js'

const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g

function formatContent(text: string) {
  const parts: Array<{ type: 'text' | 'code'; lang?: string; content: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null = codeBlockRegex.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'code', lang: match[1] || undefined, content: match[2] })
    lastIndex = match.index + match[0].length
    match = codeBlockRegex.exec(text)
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
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
        return h(Text, { key: i, color: '#d4d4d4' }, part.content)
      })

      return h(Box, { flexDirection: 'column', flexGrow: 1, paddingX: 1 }, children)
    }
  },
})
