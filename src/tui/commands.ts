import type { Ref } from 'vue'
import type { CommandUI } from '../agent/commands.js'
import { dispatchCommand } from '../agent/commands.js'
import type { Session } from '../agent/session.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from '../api/balance.js'
import type { Config } from '../config/index.js'
import { loadTokenUsage } from '../config/tokens.js'
import type { StatusData } from './context.js'

export function makeCommandUI(
  chatContent: Ref<string>,
  statusData: Ref<StatusData>,
  onNewSession: (session: Session) => void,
): CommandUI {
  return {
    write: (text: string) => {
      chatContent.value += `\n${text}\n`
    },
    replaceContent: (text: string) => {
      chatContent.value = text
    },
    onStateChange: () => {
      updateStatus(statusData)
    },
    onNewSession,
  }
}

export function updateStatus(statusData: Ref<StatusData>) {
  const prev = statusData.value
  statusData.value = { ...prev }
}

export function updateFooterFromSession(
  statusData: Ref<StatusData>,
  config: Config,
  session: Session,
  isRunning: boolean,
) {
  const tokenStats = loadTokenUsage(config.cwd)
  statusData.value = {
    ...statusData.value,
    agentStatus: isRunning ? 'running' : 'idle',
    mode: session.config.mode,
    model: config.model,
    provider: config.provider,
    totalInputTokens: tokenStats.totalInputTokens,
    totalOutputTokens: tokenStats.totalOutputTokens,
    totalApiCalls: tokenStats.totalApiCalls,
  }
}

export async function tryRefreshBalance(config: Config, statusData: Ref<StatusData>) {
  try {
    if (isDeepSeekOfficial(config.baseUrl) && config.apiKey) {
      const balance = await fetchDeepSeekBalance(config.apiKey)
      if (balance.isAvailable && balance.display) {
        statusData.value = {
          ...statusData.value,
          balance: balance.display,
          webBalance: balance.webDisplay,
        }
      } else {
        statusData.value = {
          ...statusData.value,
          balance: '',
          webBalance: '',
        }
      }
    }
  } catch {
    // Silently ignore
  }
}

export async function sendMessage(
  text: string,
  config: Config,
  session: Session,
  chatContent: Ref<string>,
  isRunning: Ref<boolean>,
  statusData: Ref<StatusData>,
) {
  const trimmed = text.trim()
  if (!trimmed) return

  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(' ')

    if (cmd === 'exit' || cmd === 'quit') {
      chatContent.value += `\n${statusData.value.mode} Goodbye!\n`
      return 'exit'
    }

    const ui = makeCommandUI(chatContent, statusData, newSession => {
      Object.assign(session, newSession)
    })
    const handled = await dispatchCommand(
      { session, config, ui, isRunning: isRunning.value },
      cmd,
      arg,
    )
    if (handled) {
      updateFooterFromSession(statusData, config, session, isRunning.value)
      return true
    }

    chatContent.value += `\n\u2716 Unknown command: /${cmd}. Type /help for available commands.\n`
    return true
  }

  if (isRunning.value) return

  isRunning.value = true
  updateFooterFromSession(statusData, config, session, isRunning.value)

  try {
    await session.chat(trimmed)
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    chatContent.value += `\n\u2716 Error: ${errMsg}\n`
  } finally {
    isRunning.value = false
    updateFooterFromSession(statusData, config, session, isRunning.value)
    void tryRefreshBalance(config, statusData)
  }
}
