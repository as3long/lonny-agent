import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

export const UserMessage = defineComponent({
  props: {
    content: { type: String, required: true },
  },
  setup(props) {
    return () => {
      const lines = props.content.split('\n')
      const children = lines.map((line, i) => h(Text, { key: i, color: '#d4d4d4' }, line))
      return h(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          marginY: 1,
          borderStyle: 'round',
          borderColor: colors.userLabel,
        },
        [
          h(Text, { color: colors.userLabel, bold: true }, 'You'),
          h(Box, { flexDirection: 'column', marginTop: 1 }, children),
        ],
      )
    }
  },
})
