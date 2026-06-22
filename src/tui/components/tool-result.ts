import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

const DIFF_RED = '#ff5050'
const DIFF_GREEN = '#00c864'
const DIFF_GRAY = '#969696'

function diffColor(line: string): string {
  if (line.startsWith('- ')) return DIFF_RED
  if (line.startsWith('+ ')) return DIFF_GREEN
  return DIFF_GRAY
}

export const ToolResult = defineComponent({
  props: {
    name: { type: String, required: true },
    status: { type: String, required: true },
    summary: { type: String, required: true },
    details: { type: Array, default: () => [] },
  },
  setup(props) {
    const isOk = props.status === 'OK'
    const iconColor = isOk ? colors.success : colors.error
    const borderColor = isOk ? colors.dim : colors.error

    return () => {
      const detailLines = (props.details as string[]).map((line, i) =>
        h(Text, { key: i, color: diffColor(line) }, line),
      )

      return h(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          marginY: 1,
          borderStyle: 'round',
          borderColor: borderColor,
        },
        [
          h(
            Text,
            { color: iconColor },
            `${isOk ? '✔' : '✖'} ${props.name}${props.summary ? ` ${props.summary}` : ''}`,
          ),
          detailLines.length > 0
            ? h(Box, { flexDirection: 'column', marginTop: 1 }, detailLines)
            : null,
        ],
      )
    }
  },
})
