import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

export const ThinkingBlock = defineComponent({
  props: {
    content: { type: String, required: true },
  },
  setup(props) {
    return () =>
      h(
        Box,
        {
          borderStyle: 'round',
          borderColor: colors.dim,
          paddingX: 1,
          marginY: 1,
        },
        [h(Text, { color: '#9696a0' }, props.content)],
      )
  },
})
