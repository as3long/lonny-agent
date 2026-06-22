import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'
import { colors } from './colors.js'

export const ToolInvocation = defineComponent({
  props: {
    name: { type: String, required: true },
    detail: { type: String, default: '' },
    icon: { type: String, required: true },
  },
  setup(props) {
    const isWrite = props.name === 'write_plan' || props.name === 'edit'
    const iconColor = isWrite ? colors.warn : colors.success

    return () =>
      h(
        Box,
        {
          flexDirection: 'column',
          paddingX: 1,
          marginY: 1,
        },
        [
          h(
            Text,
            { color: iconColor },
            `${props.icon} ${props.name}${props.detail ? `  ${props.detail}` : ''}`,
          ),
        ],
      )
  },
})
