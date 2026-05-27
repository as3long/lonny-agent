import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createEventBus,
  EventChannels,
  getGlobalEventBus,
  resetGlobalEventBus,
} from '../event-bus.js'

describe('EventBus', () => {
  let bus: ReturnType<typeof createEventBus>

  beforeEach(() => {
    bus = createEventBus()
  })

  describe('emit and on', () => {
    test('emits and receives events', () => {
      const received: unknown[] = []
      bus.on('test:event', data => {
        received.push(data)
      })
      bus.emit('test:event', { msg: 'hello' })
      expect(received).toHaveLength(1)
      expect(received[0]).toEqual({ msg: 'hello' })
    })

    test('supports multiple listeners on the same channel', () => {
      const a: unknown[] = []
      const b: unknown[] = []
      bus.on('test:multi', d => a.push(d))
      bus.on('test:multi', d => b.push(d))
      bus.emit('test:multi', 'data')
      expect(a).toHaveLength(1)
      expect(b).toHaveLength(1)
    })

    test('unsubscribe removes the listener', () => {
      const received: unknown[] = []
      const unsub = bus.on('test:unsub', d => received.push(d))
      unsub()
      bus.emit('test:unsub', 'should not be received')
      expect(received).toHaveLength(0)
    })

    test('handler errors do not crash the bus', () => {
      bus.on('test:err', () => {
        throw new Error('handler error')
      })
      // Should not throw
      expect(() => bus.emit('test:err', 'data')).not.toThrow()
    })

    test('async handlers are awaited safely', async () => {
      const results: string[] = []
      bus.on('test:async', async () => {
        await Promise.resolve()
        results.push('done')
      })
      bus.emit('test:async', null)
      // Give microtask a chance to run
      await Promise.resolve()
      expect(results).toHaveLength(1)
    })
  })

  describe('clear', () => {
    test('removes all listeners', () => {
      const received: unknown[] = []
      bus.on('test:clear', d => received.push(d))
      bus.clear()
      bus.emit('test:clear', 'data')
      expect(received).toHaveLength(0)
    })
  })

  describe('EventChannels constants', () => {
    test('defines all expected channels', () => {
      expect(EventChannels.SESSION_START).toBe('session:start')
      expect(EventChannels.TURN_START).toBe('turn:start')
      expect(EventChannels.TOOL_CALL).toBe('tool:call')
      expect(EventChannels.LLM_STREAM_START).toBe('llm:stream_start')
      expect(EventChannels.COMPACTION_TRIGGERED).toBe('compaction:triggered')
      expect(EventChannels.MODE_CHANGE).toBe('mode:change')
    })
  })
})

describe('getGlobalEventBus / resetGlobalEventBus', () => {
  afterEach(() => {
    resetGlobalEventBus()
  })

  test('returns the same singleton instance', () => {
    const a = getGlobalEventBus()
    const b = getGlobalEventBus()
    expect(a).toBe(b)
  })

  test('resetGlobalEventBus creates a new instance', () => {
    const a = getGlobalEventBus()
    resetGlobalEventBus()
    const b = getGlobalEventBus()
    expect(a).not.toBe(b)
  })

  test('singleton emits and receives events', () => {
    const bus = getGlobalEventBus()
    const received: unknown[] = []
    bus.on('singleton:test', d => received.push(d))
    bus.emit('singleton:test', 42)
    expect(received).toEqual([42])
  })
})
