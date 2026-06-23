import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

const DIFF_RED = '#ff5050'
const DIFF_GREEN = '#00c864'
const DIFF_GRAY = '#969696'

const TASK_COMPLETE_GREEN = '#00ff7f'
const TASK_COMPLETE_BORDER = '#00aa55'

function diffColor(line: string): string {
  if (line.startsWith('- ')) return DIFF_RED
  if (line.startsWith('+ ')) return DIFF_GREEN
  return DIFF_GRAY
}

function headerColor(line: string): string {
  const t = line.trim()
  if (/^Check\s+\d/i.test(t)) return '#d4d4d4'
  if (/^(✔|✖|✅|⚠️)/.test(t)) return TASK_COMPLETE_GREEN
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
    const isComplete = props.name === 'task_complete'
    const iconColor = isComplete ? TASK_COMPLETE_GREEN : isOk ? colors.success : colors.error
    const borderColor = isComplete ? TASK_COMPLETE_BORDER : isOk ? colors.dim : colors.error

    return () => {
      const rawDetails = props.details as string[]

      const detailLines = rawDetails.map((line, i) =>
        h(
          Text,
          {
            key: i,
            color: isComplete ? headerColor(line) : diffColor(line),
          },
          line,
        ),
      )

      // Header line: for task_complete, show a clean "✅ <summary>" without the tool name
      const headerText = isComplete
        ? `✅ ${props.summary || 'done'}`
        : `${isOk ? '✔' : '✖'} ${props.name}${props.summary ? ` ${props.summary}` : ''}`

      return h(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          marginY: 1,
          borderStyle: isComplete ? 'double' : 'round',
          borderColor: borderColor,
        },
        [
          h(Text, { color: iconColor, bold: isComplete }, headerText),
          detailLines.length > 0
            ? h(Box, { flexDirection: 'column', marginTop: 1 }, detailLines)
            : null,
        ],
      )
    }
  },
})
