import { Text, useAnimation } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kIsRunning } from '../context.js'
import { colors } from './colors.js'

const spinnerFrames = ['\u2591', '\u2592', '\u2593', '\u2592']

export const ActivityIndicator = defineComponent({
  setup() {
    const isRunning = inject(kIsRunning)!
    const { frame } = useAnimation({ interval: 80, isActive: isRunning })

    return () => {
      if (!isRunning.value) return null
      const spinner = spinnerFrames[frame.value % spinnerFrames.length]
      return h(Text, { color: colors.accent }, `${spinner} thinking...`)
    }
  },
})
