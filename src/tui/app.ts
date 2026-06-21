import { Box, useApp, useInput } from '@vue-tui/runtime'
import { defineComponent, h, onMounted, provide, ref } from 'vue'
import type { SessionOutput } from '../agent/session.js'
import { formatToolInput, Session } from '../agent/session.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from '../api/balance.js'
import type { Config } from '../config/index.js'
import { loadTokenUsage } from '../config/tokens.js'
import type { ToolCall } from '../tools/types.js'
import { sendMessage as cmdSendMessage } from './commands.js'
import { ChatInput } from './components/chat-input.js'
import { ChatMessages } from './components/chat-messages.js'
import { HeaderBar } from './components/header-bar.js'
import { HelpOverlay } from './components/help-overlay.js'
import { LandingScreen } from './components/landing-screen.js'
import { PlanDetail } from './components/plan-detail.js'
import { listPlans } from './components/plan-utils.js'
import { PlansList } from './components/plans-list.js'
import { StatusBar } from './components/status-bar.js'
import {
  kChatContent,
  kConfig,
  kIsRunning,
  kPendingConfirm,
  kPlansVersion,
  kSelectedPlanName,
  kShowPlanDetail,
  kShowPlans,
  kStatusData,
  type StatusData,
} from './context.js'

export const Root = defineComponent({
  props: {
    config: { type: Object, required: true },
    preloadedSession: { type: Object, default: null },
  },
  setup(props) {
    const config = props.config as Config
    const preloadedSession = props.preloadedSession as Session | null
    const { exit } = useApp()

    const chatContent = ref('')
    const isRunning = ref(false)
    const pendingConfirm = ref<((approved: boolean) => void) | null>(null)
    const showPlans = ref(false)
    const showHelp = ref(false)
    const showPlanDetail = ref(false)
    const selectedPlanName = ref('')
    const plansVersion = ref(0)

    const statusData = ref<StatusData>({
      mode: 'code',
      agentStatus: 'idle',
      model: config.model,
      provider: config.provider,
      planCount: 0,
      planName: '',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      balance: '',
      webBalance: '',
      phase: 'landing',
      planFilter: '',
    })

    provide(kConfig, config)
    provide(kChatContent, chatContent)
    provide(kIsRunning, isRunning)
    provide(kPendingConfirm, pendingConfirm)
    provide(kShowPlans, showPlans)
    provide(kShowPlanDetail, showPlanDetail)
    provide(kSelectedPlanName, selectedPlanName)
    provide(kStatusData, statusData)
    provide(kPlansVersion, plansVersion)

    let sessionInst: Session | null = null

    const output: SessionOutput = {
      write: (text: string) => {
        // Strip ANSI escape sequences (terminal-only formatting)
        let clean = text.replace(/\x1b\[[0-9;]*m/g, '')
        // Strip thinking box borders — terminal wrapping with │/╭/╰ breaks
        // in TUI since the Text component handles its own wrapping naturally.
        clean = clean.replace(/^[ \t]*[│╰╭─]/gm, line => line.replace(/[│╰╭─]/g, ' '))
        chatContent.value += clean
      },
      suppressToolOutput: false,
      confirmTool: async (toolCalls: ToolCall[]) => {
        chatContent.value += `\n  Allow these tool calls?\n`
        for (const tc of toolCalls) {
          const detail = formatToolInput(tc)
          chatContent.value += `  \u2022 ${tc.name}${detail ? ` ${detail}` : ''}\n`
        }
        chatContent.value += `  (y/N) `

        return new Promise(resolve => {
          pendingConfirm.value = resolve
        })
      },
    }

    function updateTokenStats() {
      const tokenStats = loadTokenUsage(config.cwd)
      statusData.value = {
        ...statusData.value,
        totalInputTokens: tokenStats.totalInputTokens,
        totalOutputTokens: tokenStats.totalOutputTokens,
        totalApiCalls: tokenStats.totalApiCalls,
      }
    }

    function refreshPlanCount() {
      const plans = listPlans(config.cwd)
      statusData.value = { ...statusData.value, planCount: plans.length }
    }

    let landingSubmitTimer: ReturnType<typeof setTimeout> | null = null

    onMounted(async () => {
      let loaded: Session | null = preloadedSession
      let restored = false

      if (!loaded) {
        loaded = await Session.load(config, output)
      }

      if (loaded) {
        restored = true
        sessionInst = loaded
        sessionInst.onPlanWritten = () => {
          plansVersion.value++
          refreshPlanCount()
        }
        const lastUserMsg = [...sessionInst.messages].reverse().find(m => m.role === 'user')
        const lastQuestion =
          lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : null
        chatContent.value = '\n\u21BA Resumed previous session'
        if (lastQuestion) {
          const preview =
            lastQuestion.length > 80 ? `${lastQuestion.slice(0, 80)}\u2026` : lastQuestion
          chatContent.value += ` \u2014 ${preview}`
        }
        chatContent.value += '\n\n'
      } else {
        sessionInst = new Session(config, output)
        sessionInst.onPlanWritten = () => {
          plansVersion.value++
          refreshPlanCount()
        }
      }

      updateTokenStats()
      refreshPlanCount()

      // Keep landing screen visible for at least 1.5s so users can see it,
      // even when a previous session was restored.
      if (restored) {
        landingSubmitTimer = setTimeout(() => {
          statusData.value = { ...statusData.value, phase: 'chat' }
          landingSubmitTimer = null
        }, 1500)
      }

      try {
        if (isDeepSeekOfficial(config.baseUrl) && config.apiKey) {
          const balance = await fetchDeepSeekBalance(config.apiKey)
          if (balance.isAvailable && balance.display) {
            statusData.value = {
              ...statusData.value,
              balance: balance.display,
              webBalance: balance.webDisplay,
            }
          }
        }
      } catch {}
    })

    useInput((input, key) => {
      if (pendingConfirm.value) {
        const k = input.trim().toLowerCase()
        if (k === 'y' || k === 'yes') {
          pendingConfirm.value(true)
          pendingConfirm.value = null
          chatContent.value += 'y\n'
        } else if (k === 'n' || k === 'no' || k === '\r' || key.return || key.escape) {
          pendingConfirm.value(false)
          pendingConfirm.value = null
          chatContent.value += 'N\n'
        }
        return
      }

      if (key.ctrl && input === 'c') {
        exit()
        return
      }

      if (showHelp.value && key.escape) {
        showHelp.value = false
        return
      }

      if (input === '?' && !showPlans.value && !showPlanDetail.value) {
        showHelp.value = !showHelp.value
        return
      }
    })

    function handleSubmit(text: string) {
      if (!sessionInst) return

      const trimmed = text.trim()
      if (!trimmed) return

      if (trimmed.startsWith('/')) {
        const parts = trimmed.slice(1).split(/\s+/)
        const cmd = parts[0]
        const arg = parts.slice(1).join(' ')

        if (cmd === 'exit' || cmd === 'quit') {
          chatContent.value += '\nGoodbye!\n'
          exit()
          return
        }
        if (cmd === 'plans') {
          showPlans.value = !showPlans.value
          return
        }
        if (cmd === 'help' || cmd === '?') {
          showHelp.value = !showHelp.value
          return
        }
      }

      void cmdSendMessage(text, config, sessionInst, chatContent, isRunning, statusData)
    }

    function onLandingSubmit() {
      // User pressed Enter — skip the landing timer and switch to chat immediately
      if (landingSubmitTimer) {
        clearTimeout(landingSubmitTimer)
        landingSubmitTimer = null
      }
      statusData.value = { ...statusData.value, phase: 'chat' }
    }

    return () => {
      const isLanding = statusData.value.phase === 'landing'

      const mainContent = isLanding
        ? h(LandingScreen, { onSubmit: onLandingSubmit })
        : h(Box, { flexDirection: 'column', flexGrow: 1 }, [
            h(ChatMessages),
            h(ChatInput, { onSubmit: handleSubmit }),
          ])

      const content = showHelp.value ? h(HelpOverlay) : mainContent

      return h(
        Box,
        { flexDirection: 'column', width: '100%', height: '100%', position: 'relative' },
        [
          h(HeaderBar),
          h(Box, { flexGrow: 1, flexDirection: 'column' }, [content]),
          h(StatusBar),
          showPlans.value && !showPlanDetail.value ? h(PlansList) : null,
          showPlanDetail.value ? h(PlanDetail) : null,
        ],
      )
    }
  },
})
