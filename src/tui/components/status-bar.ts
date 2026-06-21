import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kConfig, kStatusData } from '../context.js'
import { APP_VERSION, colors } from './colors.js'
import { formatTokens } from './header-bar.js'

export const StatusBar = defineComponent({
  setup() {
    const config = inject(kConfig)!
    const statusData = inject(kStatusData)!

    return () => {
      const s = statusData.value
      if (s.phase === 'landing') {
        const dir = config.cwd.length > 30 ? `...${config.cwd.slice(-27)}` : config.cwd
        return h(Box, { backgroundColor: colors.statusBg }, [
          h(Text, { color: colors.accent }, '\u25A0'),
          h(Text, { color: colors.dim }, ` ${dir}  ready  v${APP_VERSION}`),
        ])
      }

      const isRunning = s.agentStatus === 'running'
      const statusDot = isRunning ? '\u25CF' : '\u25CB'
      const statusLabel = isRunning ? 'running' : 'idle'
      const statusColor = isRunning ? colors.running : colors.dim

      const restSegments: string[] = []
      restSegments.push(s.mode)

      if (s.model) {
        restSegments.push(`${s.provider}/${s.model}`)
      }

      const totalTokens = s.totalInputTokens + s.totalOutputTokens
      if (totalTokens > 0) {
        const tokenStr = `\u25B4${formatTokens(s.totalInputTokens)} \u25BE${formatTokens(s.totalOutputTokens)}  ${formatTokens(totalTokens)}`
        restSegments.push(tokenStr)
        restSegments.push(`${s.totalApiCalls}c`)
      }

      if (s.webBalance) {
        restSegments.push(`\u4F59\u989D\uFF1A${s.webBalance}`)
      } else if (s.balance) {
        restSegments.push(`\u4F59\u989D\uFF1A${s.balance}`)
      }

      const sep = ` \u2502 `
      const dir = config.cwd.length > 30 ? `...${config.cwd.slice(-27)}` : config.cwd

      return h(Box, { backgroundColor: colors.statusBg, minHeight: 1 }, [
        h(Text, { color: colors.accent }, '\u25A0'),
        h(Text, { color: colors.dim }, ` ${dir} `),
        h(Text, { color: statusColor }, `${statusDot} ${statusLabel}`),
        h(
          Text,
          { color: colors.dim },
          restSegments.length > 0 ? `${sep} ${restSegments.join(sep)} ` : '',
        ),
        h(Text, { color: colors.dim }, ` v${APP_VERSION} `),
      ])
    }
  },
})
