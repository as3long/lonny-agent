import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

export const TokenStats = defineComponent({
  props: {
    text: { type: String, required: true },
  },
  setup(props) {
    return () =>
      h(
        Box,
        {
          paddingX: 1,
          marginY: 1,
        },
        [h(Text, { color: colors.dim }, props.text)],
      )
  },
})
