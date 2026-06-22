import { EventChannels, getGlobalEventBus } from '../agent/event-bus.js'
import type { Session } from '../agent/session.js'
import type { Config } from '../config/index.js'

/**
 * Bridge between Session/EventBus and WebSocket.
 * Listens to EventBus events and forwards them as JSON messages.
 */

/** Strip ANSI escape codes from a string (terminal colors are meaningless in the browser) */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

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

  // Send initial handshake with current token stats and session info
  send({
    type: 'hello',
    version: WS_PROTOCOL_VERSION,
    sessionId: session.sessionId,
    sessionTitle: session.sessionTitle || undefined,
    mode: config.mode,
    model: config.model,
    provider: config.provider,
    totalIn: session.totalInputTokens,
    totalOut: session.totalOutputTokens,
    totalApi: session.totalApiCalls,
    totalCacheHit: session.totalCacheHitTokens || undefined,
    totalCacheMiss: session.totalCacheMissTokens || undefined,
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
    send({
      type: 'tool_result',
      name: d.name,
      id: d.id,
      success: true,
      output: d.name === 'edit' ? d.output : stripAnsi(d.output),
    })
  })

  const unsubToolError = bus.on(EventChannels.TOOL_ERROR, data => {
    const d = data as { name: string; id: string; error: string }
    send({ type: 'tool_result', name: d.name, id: d.id, success: false, error: stripAnsi(d.error) })
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

  const unsubUserMessage = bus.on(EventChannels.USER_MESSAGE, data => {
    const d = data as { prompt: string }
    send({ type: 'user_message', text: d.prompt })
  })

  const unsubCompaction = bus.on(EventChannels.COMPACTION_TRIGGERED, data => {
    const d = data as { before: number; after: number }
    send({ type: 'compaction', before: d.before, after: d.after })
  })

  const unsubTokenStats = bus.on(EventChannels.TOKEN_STATS, data => {
    const d = data as {
      turnIn: number
      turnOut: number
      totalIn: number
      totalOut: number
      turnApi: number
      totalApi: number
      turnCacheHit?: number
      turnCacheMiss?: number
      totalCacheHit?: number
      totalCacheMiss?: number
    }
    send({ type: 'token_stats', ...d })
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

          if (
            cmd === 'mode' &&
            (arg === 'code' || arg === 'plan' || arg === 'ask' || arg === 'loop')
          ) {
            session.setMode(arg as 'code' | 'plan' | 'ask' | 'loop')
            send({ type: 'mode_changed', mode: arg })
            return
          }

          if (cmd === 'model' && arg) {
            session.config.model = arg
            session.setMode(session.config.mode)
            send({ type: 'model_changed', model: arg })
            return
          }

          if (cmd === 'help') {
            send({
              type: 'help',
              commands: [
                '/mode code|plan|ask|loop - Switch mode',
                '/model <name> - Switch model',
                '/sessions - List saved sessions',
                '/session - Show current session info',
                '/session title <name> - Name current session',
                '/session delete <id> - Delete a session',
                '/fork - Fork a new session from current context',
                '/new - Start a new session',
                '/help - Show this help',
              ],
            })
            return
          }

          if (cmd === 'sessions') {
            const { Session } = await import('../agent/session.js')
            const allSessions = Session.listSessions()
            send({
              type: 'sessions',
              sessions: allSessions.map(s => ({
                id: s.id,
                cwd: s.cwd,
                title: s.title,
                messageCount: s.messageCount,
                mode: s.mode,
                model: s.model,
                provider: s.provider,
                totalInputTokens: s.totalInputTokens,
                totalOutputTokens: s.totalOutputTokens,
                totalApiCalls: s.totalApiCalls,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              })),
            })
            return
          }

          if (cmd === 'session') {
            if (arg === 'delete' || arg.startsWith('delete ')) {
              const { Session } = await import('../agent/session.js')
              const id = arg.slice(arg.startsWith('delete ') ? 7 : 6).trim()
              const deleted = id ? Session.deleteSession(id) : false
              send({ type: 'session_deleted', id, success: deleted })
            } else if (arg.startsWith('title ')) {
              const title = arg.slice(6).trim()
              if (title) {
                session.sessionTitle = title
                session.save()
                send({ type: 'session_titled', title })
              } else {
                send({ type: 'error', message: 'Usage: /session title <name>' })
              }
            } else if (arg === 'export') {
              try {
                const filePath = session.exportSession()
                send({ type: 'session_exported', filePath })
              } catch (err) {
                send({ type: 'error', message: `Export failed: ${err}` })
              }
            } else {
              send({
                type: 'session_info',
                id: session.sessionId,
                title: session.sessionTitle || '(untitled)',
                mode: session.config.mode,
                model: session.config.model,
                provider: session.config.provider,
                messageCount: session.messages.length,
                totalInputTokens: session.totalInputTokens,
                totalOutputTokens: session.totalOutputTokens,
                totalApiCalls: session.totalApiCalls,
                createdAt: session.sessionCreatedAt,
              })
            }
            return
          }

          if (cmd === 'fork') {
            const forked = session.fork()
            send({ type: 'session_forked', id: forked.sessionId, title: forked.sessionTitle })
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

      case 'stop':
        session.stop()
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
      unsubUserMessage()
      unsubCompaction()
      unsubTokenStats()
    },
    sendMessage: async (text: string) => {
      await handleClientMessage({ type: 'message', text })
    },
  }
}
