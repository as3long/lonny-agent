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

      const segments: string[] = []

      const statusDot = s.agentStatus === 'running' ? '\u25CF' : '\u25CB'
      const statusLabel = s.agentStatus === 'running' ? 'running' : 'idle'
      segments.push(`${statusDot} ${statusLabel}`)

      segments.push(s.mode)

      if (s.model) {
        segments.push(`${s.provider}/${s.model}`)
      }

      const totalTokens = s.totalInputTokens + s.totalOutputTokens
      if (totalTokens > 0) {
        const tokenStr = `\u25B4${formatTokens(s.totalInputTokens)} \u25BE${formatTokens(s.totalOutputTokens)}  ${formatTokens(totalTokens)}`
        segments.push(tokenStr)
        segments.push(`${s.totalApiCalls}c`)
      }

      if (s.webBalance) {
        segments.push(`\u4F59\u989D\uFF1A${s.webBalance}`)
      } else if (s.balance) {
        segments.push(`\u4F59\u989D\uFF1A${s.balance}`)
      }

      const sep = ` \u2502 `
      const centerContent = `  ${segments.join(sep)}  `

      const dir = config.cwd.length > 30 ? `...${config.cwd.slice(-27)}` : config.cwd

      return h(Box, { backgroundColor: colors.statusBg, minHeight: 1 }, [
        h(Text, { color: colors.accent }, '\u25A0'),
        h(Text, { color: colors.dim }, ` ${dir}`),
        h(Text, { color: colors.dim }, centerContent),
        h(Text, { color: colors.dim }, ` v${APP_VERSION} `),
      ])
    }
  },
})
