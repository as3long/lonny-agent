import { Box, Text } from '@vue-tui/runtime'
import { computed, defineComponent, h } from 'vue'

export interface Suggestion {
  name: string
  description: string
  argumentHint?: string
}

export const CommandSuggestions = defineComponent({
  props: {
    suggestions: { type: Array as () => Suggestion[], required: true },
    selectedIndex: { type: Number, required: true },
  },
  setup(props) {
    return () => {
      const items = props.suggestions
      if (!items || items.length === 0) return null

      const lines = items.map((cmd, i) => {
        const isSelected = i === props.selectedIndex
        const prefix = isSelected ? '\u25B6 ' : '  '
        const color = isSelected ? '#00aaff' : '#888888'
        const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
        return h(Text, { key: i, color }, `  ${prefix}/${cmd.name}${hint}  ${cmd.description}`)
      })

      return h(Box, { flexDirection: 'column' }, lines)
    }
  },
})
