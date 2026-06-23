import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { Config } from '../../config/index.js'
import type { LLMMessage } from '../llm.js'
import { Session } from '../session.js'

const TEST_SESSIONS_ROOT = path.join(process.cwd(), '.test-sessions')

beforeAll(() => {
  // Clean up any stale .test-sessions subdirectories left from previous runs
  if (fs.existsSync(TEST_SESSIONS_ROOT)) {
    for (const entry of fs.readdirSync(TEST_SESSIONS_ROOT)) {
      const fullPath = path.join(TEST_SESSIONS_ROOT, entry)
      try {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

afterAll(() => {
  // Clean up all .test-sessions subdirectories after the suite completes
  if (fs.existsSync(TEST_SESSIONS_ROOT)) {
    try {
      fs.rmSync(TEST_SESSIONS_ROOT, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

/**
 * Helper: build a minimal Config with a project-subdir cwd for test session files.
 * Using the project directory ensures detectPackageManager etc. find a valid cwd.
 * Each test gets a fresh subdirectory.
 */
function testConfig(): Config {
  const testDir = path.join(TEST_SESSIONS_ROOT, crypto.randomUUID().slice(0, 8))
  fs.mkdirSync(testDir, { recursive: true })
  // Create a package.json so detectPackageManager doesn't fail async
  fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'test' }), 'utf-8')
  return {
    mode: 'code',
    model: 'test-model',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: 'http://test',
    cwd: testDir,
    autoApprove: true,
    thinking: false,
    reasoningEffort: 'medium',
    enableCache: false,
    strictTools: false,
    contextWindow: 128_000,
  }
}

/**
 * Build the session file path matching what save() would write.
 */
function sessionFilePath(cwd: string, sessionId: string): string {
  const { createHash } = require('node:crypto')
  const absPath = path.resolve(cwd)
  const hash = createHash('sha256').update(absPath, 'utf-8').digest('hex').slice(0, 12)
  const dirName = path.basename(absPath)
  const safeName = dirName.replace(/[<>:"/\\|?*]/g, '_')
  const base = `${safeName}-${hash}`
  const sessionDir = path.join(os.homedir(), '.lonny', 'sessions')
  return path.join(sessionDir, `${base}-${sessionId}.json`)
}

describe('Session save/load cycle', () => {
  let config: Config
  let sessionId: string
  let filePath: string

  beforeEach(() => {
    config = testConfig()
    const { randomUUID } = require('node:crypto')
    sessionId = randomUUID().slice(0, 8)
    filePath = sessionFilePath(config.cwd, sessionId)
    // Ensure session directory exists
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
    // Don't clean up per-test .test-sessions subdir here — buildSystemPrompt fires async and may
    // still be reading the cwd. The root .test-sessions/ is cleaned by afterAll instead.
  })

  test('restores assistant message with text + tool_calls + tool results', async () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Fix the bug in the code.' },
      {
        role: 'assistant',
        content: 'I see the root cause. Three fixes needed:\n\n1. Remove X\n2. Add Y',
        tool_calls: [
          { id: 'call_abc', name: 'edit', input: { file: 'test.ts', old: 'a', new: 'b' } },
          { id: 'call_def', name: 'read', input: { file: 'test.ts' } },
        ],
      },
      { role: 'tool', content: 'Edited test.ts', tool_call_id: 'call_abc', name: 'edit' },
      { role: 'tool', content: 'File contents...', tool_call_id: 'call_def', name: 'read' },
      { role: 'assistant', content: 'Done with fixes.' },
      { role: 'user', content: 'Great, thanks!' },
    ]

    // Write session file (simulating what save() would produce)
    const data = {
      id: sessionId,
      cwd: path.resolve(config.cwd),
      messages,
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalApiCalls: 2,
      mode: 'code',
      model: 'test-model',
      provider: 'test-provider',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

    // Load the session from disk
    const session = await Session.load(config)
    expect(session).not.toBeNull()

    // Verify ALL messages are preserved
    expect(session!.messages.length).toBe(messages.length)
    for (let i = 0; i < messages.length; i++) {
      expect(session!.messages[i].role).toBe(messages[i].role)
    }

    // Verify the critical assistant message (text + tool_calls)
    const assistantWithTools = session!.messages.find(
      m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    )
    expect(assistantWithTools).toBeDefined()
    expect(assistantWithTools!.content).toContain('I see the root cause')
    expect(assistantWithTools!.tool_calls).toHaveLength(2)

    // Verify tool results still reference the correct tool_call_ids
    const toolMsgs = session!.messages.filter(m => m.role === 'tool')
    expect(toolMsgs).toHaveLength(2)
    expect(toolMsgs[0].tool_call_id).toBe('call_abc')
    expect(toolMsgs[1].tool_call_id).toBe('call_def')
  })

  test('preserves assistant message with text-only (no tool_calls)', async () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: "I'm great, thanks!" },
    ]

    const data = {
      id: sessionId,
      cwd: path.resolve(config.cwd),
      messages,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      mode: 'code',
      model: 'test-model',
      provider: 'test-provider',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

    const session = await Session.load(config)
    expect(session).not.toBeNull()
    expect(session!.messages.length).toBe(messages.length)
    expect(session!.messages[2].content).toBe('Hi there!')
    expect(session!.messages[4].content).toBe("I'm great, thanks!")
  })

  test('loads session with most messages when multiple session files exist', async () => {
    // Create a "newer but emptier" session file
    const newSessionId = 'new_empty_' + require('node:crypto').randomUUID().slice(0, 4)
    const newFilePath = sessionFilePath(config.cwd, newSessionId)
    const emptyMessages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Hello' },
    ]
    const newData = {
      id: newSessionId,
      cwd: path.resolve(config.cwd),
      messages: emptyMessages,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      mode: 'code',
      model: 'test-model',
      provider: 'test-provider',
      createdAt: new Date(Date.now() + 60_000).toISOString(), // 1 minute in the future
      updatedAt: new Date(Date.now() + 60_000).toISOString(), // 1 minute in the future
    }
    fs.writeFileSync(newFilePath, JSON.stringify(newData, null, 2), 'utf-8')

    // Create an "older but fuller" session file
    const fullMessages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Do the first thing.' },
      {
        role: 'assistant',
        content: 'Working on it.',
        tool_calls: [{ id: 't1', name: 'bash', input: { command: 'echo 1' } }],
      },
      { role: 'tool', content: '1', tool_call_id: 't1', name: 'bash' },
      { role: 'user', content: 'Now the second thing.' },
      { role: 'assistant', content: 'Doing it.' },
      { role: 'user', content: 'Great!' },
    ]

    const data = {
      id: sessionId,
      cwd: path.resolve(config.cwd),
      messages: fullMessages,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      mode: 'code',
      model: 'test-model',
      provider: 'test-provider',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), // OLDER timestamp
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

    // Load — should pick the FULL session (7 messages) over the NEWER but EMPTIER one (2 messages)
    const session = await Session.load(config)
    expect(session).not.toBeNull()
    expect(session!.messages.length).toBe(7)
    expect(session!.messages[1].content).toBe('Do the first thing.')

    // Clean up the extra file
    try {
      fs.unlinkSync(newFilePath)
    } catch {
      /* ignore */
    }
  })

  test('sanitizeMessages keeps complete assistant+tool sequences', async () => {
    // Two complete turns, each with tool_calls+results — should all survive
    const messages: LLMMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'Do the first thing.' },
      {
        role: 'assistant',
        content: 'Working on it.',
        tool_calls: [{ id: 't1', name: 'bash', input: { command: 'echo 1' } }],
      },
      { role: 'tool', content: '1', tool_call_id: 't1', name: 'bash' },
      { role: 'user', content: 'Now the second thing.' },
      {
        role: 'assistant',
        content: 'Doing it.',
        tool_calls: [
          { id: 't2', name: 'bash', input: { command: 'echo 2' } },
          { id: 't3', name: 'edit', input: { file: 'x.ts', old: 'a', new: 'b' } },
        ],
      },
      { role: 'tool', content: '2', tool_call_id: 't2', name: 'bash' },
      { role: 'tool', content: 'Edited x.ts', tool_call_id: 't3', name: 'edit' },
      { role: 'assistant', content: 'Done!' },
    ]

    const data = {
      id: sessionId,
      cwd: path.resolve(config.cwd),
      messages,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      mode: 'code',
      model: 'test-model',
      provider: 'test-provider',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

    const session = await Session.load(config)
    expect(session).not.toBeNull()
    expect(session!.messages.length).toBe(messages.length)

    // Both assistant messages with tool_calls should be present
    const assistantWithTools = session!.messages.filter(
      m => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    )
    expect(assistantWithTools).toHaveLength(2)
    expect(assistantWithTools[0].content).toBe('Working on it.')
    expect(assistantWithTools[1].content).toBe('Doing it.')
  })
})
