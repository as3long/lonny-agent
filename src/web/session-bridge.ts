import { EventChannels, getGlobalEventBus } from '../agent/event-bus.js'
import type { Session } from '../agent/session.js'
import type { Config } from '../config/index.js'

/**
 * Bridge between Session/EventBus and WebSocket.
 * Listens to EventBus events and forwards them as JSON messages.
 */

export interface WsMessage {
  type: string
  [key: string]: unknown
}

export type SendFn = (msg: WsMessage) => void

const WS_PROTOCOL_VERSION = 1

export function startSessionBridge(
  session: Session,
  config: Config,
  send: SendFn,
): { close: () => void; sendMessage: (text: string) => Promise<void> } {
  const bus = getGlobalEventBus()

  // Send initial handshake
  send({
    type: 'hello',
    version: WS_PROTOCOL_VERSION,
    mode: config.mode,
    model: config.model,
    provider: config.provider,
  })

  // ── Subscribe to EventBus ──

  const unsubTurnStart = bus.on(EventChannels.TURN_START, data => {
    const d = data as { prompt?: string }
    send({ type: 'turn_start', prompt: d.prompt || '' })
  })

  const unsubToolCall = bus.on(EventChannels.TOOL_CALL, data => {
    const d = data as { name: string; input: Record<string, unknown>; id: string }
    send({ type: 'tool_call', name: d.name, input: d.input, id: d.id })
  })

  const unsubToolResult = bus.on(EventChannels.TOOL_RESULT, data => {
    const d = data as { name: string; id: string; output: string }
    send({ type: 'tool_result', name: d.name, id: d.id, success: true, output: d.output })
  })

  const unsubToolError = bus.on(EventChannels.TOOL_ERROR, data => {
    const d = data as { name: string; id: string; error: string }
    send({ type: 'tool_result', name: d.name, id: d.id, success: false, error: d.error })
  })

  const unsubTurnEnd = bus.on(EventChannels.TURN_END, data => {
    const d = data as { iterations: number; toolCallCount: number }
    send({ type: 'turn_end', iterations: d.iterations, toolCallCount: d.toolCallCount })
  })

  const unsubThinking = bus.on(EventChannels.THINKING, data => {
    const d = data as { text: string }
    send({ type: 'thinking', text: d.text })
  })

  const unsubThinkingEnd = bus.on(EventChannels.THINKING_END, () => {
    send({ type: 'thinking_end' })
  })

  const unsubCompaction = bus.on(EventChannels.COMPACTION_TRIGGERED, data => {
    const d = data as { before: number; after: number }
    send({ type: 'compaction', before: d.before, after: d.after })
  })

  // ── Handle incoming messages from client ──

  async function handleClientMessage(msg: WsMessage): Promise<void> {
    switch (msg.type) {
      case 'message': {
        const text = String(msg.text || '')
        if (!text.trim()) return

        // Handle slash commands
        if (text.startsWith('/')) {
          const parts = text.slice(1).split(/\s+/)
          const cmd = parts[0]
          const arg = parts.slice(1).join(' ')

          if (cmd === 'mode' && (arg === 'code' || arg === 'plan' || arg === 'ask')) {
            session.setMode(arg as 'code' | 'plan' | 'ask')
            send({ type: 'mode_changed', mode: arg })
            return
          }

          if (cmd === 'model' && arg) {
            session.config.model = arg
            session.setMode(session.config.mode)
            send({ type: 'model_changed', model: arg })
            return
          }

          if (cmd === 'new') {
            const { Session } = await import('../agent/session.js')
            Session.clearSavedSession(config.cwd)
            send({ type: 'session_cleared' })
            return
          }

          if (cmd === 'help') {
            send({
              type: 'help',
              commands: [
                '/mode code|plan|ask - Switch mode',
                '/model <name> - Switch model',
                '/new - Start a new session',
                '/help - Show this help',
              ],
            })
            return
          }

          send({ type: 'error', message: `Unknown command: ${cmd}` })
          return
        }

        // Send user message to session
        try {
          await session.chat(text)
          send({ type: 'done', reason: 'stop' })
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          send({ type: 'error', message: errMsg })
          send({ type: 'done', reason: 'error' })
        }
        return
      }

      case 'ping':
        send({ type: 'pong' })
        return

      default:
        send({ type: 'error', message: `Unknown message type: ${msg.type}` })
    }
  }

  return {
    close: () => {
      unsubTurnStart()
      unsubToolCall()
      unsubToolResult()
      unsubToolError()
      unsubTurnEnd()
      unsubThinking()
      unsubThinkingEnd()
      unsubCompaction()
    },
    sendMessage: async (text: string) => {
      await handleClientMessage({ type: 'message', text })
    },
  }
}
