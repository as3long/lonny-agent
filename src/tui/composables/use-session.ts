import type { Ref } from 'vue'
import { ref, shallowRef } from 'vue'
import { formatToolInput, Session, type SessionOutput } from '../../agent/session.js'
import type { Config } from '../../config/index.js'
import { colors } from '../components/colors.js'

export function useSession(
  config: Config,
  chatContent: Ref<string>,
  pendingConfirm: Ref<((approved: boolean) => void) | null>,
  preloadedSession?: Session,
) {
  const session = shallowRef<Session>(null!)
  const isRunning = ref(false)

  const output: SessionOutput = {
    write: (text: string) => {
      chatContent.value += text
    },
    suppressToolOutput: false,
    confirmTool: async toolCalls => {
      chatContent.value += `\n  ${colors.warn} Allow these tool calls?\n`
      for (const tc of toolCalls) {
        const detail = formatToolInput(tc)
        chatContent.value += `  \u2022 ${colors.accent}${tc.name}${detail ? ` ${colors.dim}${detail}` : ''}\n`
      }
      chatContent.value += `  (y/N) `

      return new Promise(resolve => {
        pendingConfirm.value = resolve
      })
    },
  }

  const planCb = () => {
    plansVersion.value++
  }

  const plansVersion = ref(0)

  async function initSession() {
    let restoredSession: Session | null = preloadedSession ?? null
    let restored = false

    if (!restoredSession) {
      restoredSession = await Session.load(config, output)
    }
    if (restoredSession) {
      restored = true
      session.value = restoredSession
      session.value.onPlanWritten = planCb
      const lastUserMsg = [...session.value.messages].reverse().find(m => m.role === 'user')
      const lastQuestion =
        lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : null
      chatContent.value = `\n\u21BA Resumed previous session`
      if (lastQuestion) {
        const preview =
          lastQuestion.length > 80 ? `${lastQuestion.slice(0, 80)}\u2026` : lastQuestion
        chatContent.value += ` \u2014 ${preview}`
      }
      chatContent.value += '\n\n'
    } else {
      session.value = new Session(config, output)
      session.value.onPlanWritten = planCb
    }

    return restored
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return

    if (trimmed.startsWith('/')) {
      return handleCommand(trimmed)
    }

    if (isRunning.value) return

    isRunning.value = true

    try {
      await session.value.chat(trimmed)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      chatContent.value += `\n\u2716 Error: ${errMsg}\n`
    } finally {
      isRunning.value = false
      plansVersion.value++
    }
  }

  async function handleCommand(trimmed: string) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(' ')
    return { cmd, arg }
  }

  return { session, isRunning, output, plansVersion, initSession, sendMessage }
}
