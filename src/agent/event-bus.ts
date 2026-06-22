import { EventEmitter } from 'node:events'

/**
 * Lightweight EventBus for component decoupling.
 * Inspired by pi's event-bus.ts.
 *
 * Enables:
 * - TUI updates without direct coupling to session logic
 * - Tool call monitoring and logging
 * - Extension lifecycle events
 * - State change notifications
 */

export interface EventBus {
  /** Emit an event on a channel */
  emit(channel: string, data: unknown): void
  /** Subscribe to a channel. Returns unsubscribe function. */
  on(channel: string, handler: (data: unknown) => void): () => void
  /** Remove all listeners */
  clear(): void
}

/** Predefined event channels */
export const EventChannels = {
  // Session events
  SESSION_START: 'session:start',
  SESSION_SAVE: 'session:save',
  SESSION_RESTORE: 'session:restore',
  SESSION_CLEAR: 'session:clear',
  SESSION_ERROR: 'session:error',

  // Turn events
  TURN_START: 'turn:start',
  TURN_END: 'turn:end',

  // Tool events
  TOOL_CALL: 'tool:call',
  TOOL_RESULT: 'tool:result',
  TOOL_ERROR: 'tool:error',

  // LLM events
  LLM_STREAM_START: 'llm:stream_start',
  LLM_STREAM_CHUNK: 'llm:stream_chunk',
  LLM_STREAM_END: 'llm:stream_end',
  THINKING: 'llm:thinking',
  THINKING_END: 'llm:thinking_end',
  USER_MESSAGE: 'llm:user_message',
  TOOL_INVOCATION: 'llm:tool_invocation',

  // Compaction events
  COMPACTION_TRIGGERED: 'compaction:triggered',

  // Token stats
  TOKEN_STATS: 'token:stats',

  // Mode events
  MODE_CHANGE: 'mode:change',

  // Model events
  MODEL_CHANGE: 'model:change',

  // Skills events
  SKILLS_LOADED: 'skills:loaded',

  // Prompt events
  PROMPTS_LOADED: 'prompts:loaded',
} as const

export function createEventBus(): EventBus {
  const emitter = new EventEmitter()

  return {
    emit: (channel, data) => {
      emitter.emit(channel, data)
    },
    on: (channel, handler) => {
      const safeHandler = async (data: unknown) => {
        try {
          await handler(data)
        } catch (err) {
          console.error(`[EventBus] Handler error on "${channel}":`, err)
        }
      }
      emitter.on(channel, safeHandler)
      return () => emitter.off(channel, safeHandler)
    },
    clear: () => {
      emitter.removeAllListeners()
    },
  }
}

/** Singleton event bus instance */
let _globalBus: EventBus | null = null

export function getGlobalEventBus(): EventBus {
  if (!_globalBus) {
    _globalBus = createEventBus()
  }
  return _globalBus
}

export function resetGlobalEventBus(): void {
  if (_globalBus) {
    _globalBus.clear()
    _globalBus = null
  }
}
