import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kConfig, kStatusData } from '../context.js'
import { colors } from './colors.js'

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function formatCostShort(cost: string): string {
  // cost is like "$0.12" or "<$0.01" — return as-is for header
  return cost
}

export const HeaderBar = defineComponent({
  setup() {
    const config = inject(kConfig)!
    const statusData = inject(kStatusData)!

    return () => {
      const s = statusData.value
      const modeColor =
        s.mode === 'ask'
          ? colors.success
          : s.mode === 'loop'
            ? colors.accent
            : s.mode === 'review'
              ? colors.success
              : colors.warn
      const statusDot = s.agentStatus === 'running' ? colors.running : colors.dim
      const statusLabel = s.agentStatus === 'running' ? 'running' : 'idle'
      const modelInfo = `${s.provider}/${s.model}`

      let rightPart = `${statusDot}\u25CF ${statusLabel}  ${s.mode}  ${modelInfo}`

      const totalTokens = s.totalInputTokens + s.totalOutputTokens
      if (totalTokens > 0) {
        const tokenStr = `\u25B4${formatTokens(s.totalInputTokens)} \u25BE${formatTokens(s.totalOutputTokens)}  ${formatTokens(totalTokens)}`
        const callsStr = `${s.totalApiCalls}c`
        rightPart += `  |  ${tokenStr} ${callsStr}`
        if (s.cost) {
          rightPart += `  ${s.cost}`
        }
      }

      if (s.planCount > 0) {
        rightPart += `  |  ${s.planCount} plan${s.planCount > 1 ? 's' : ''}`
        if (s.planName) rightPart += ` ${s.planName}`
      }

      return h(Box, { flexDirection: 'column', flexShrink: 0 }, [
        h(Box, { backgroundColor: colors.headerBg }, [
          h(Text, { color: colors.accent }, `\u2588 lonny`),
          h(Text, { color: colors.dim }, ` \u00B7  `),
          h(Text, { color: colors.dim }, rightPart),
        ]),
        h(Text, { color: colors.separator }, '\u2500'.repeat(120)),
      ])
    }
  },
})
