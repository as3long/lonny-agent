// ── HighlightBlock Component ─────────────────────────────────────────────
// Renders a code block with syntax highlighting via highlightLine()

import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { highlightLine } from '../highlight.js'
import { colors } from './colors.js'

export const HighlightBlock = defineComponent({
  props: {
    lang: { type: String, default: '' },
    content: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const lines = props.content.split('\n')
      const highlighted = lines
        .map(line => {
          if (props.lang) {
            return highlightLine(line, props.lang) || line
          }
          return line
        })
        .join('\n')

      return h(
        Box,
        {
          borderStyle: 'round',
          borderColor: colors.dim,
          paddingX: 1,
          marginY: 1,
        },
        [h(Text, { color: '#c8c8c8' }, highlighted)],
      )
    }
  },
})
