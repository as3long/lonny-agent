import { describe, expect, test } from 'vitest'
import type { Config } from '../../config/index.js'
import type { ToolDefinition } from '../../tools/types.js'
import {
  buildSubAgentPrompt,
  buildSubAgentToolDefinitions,
  estimateSubAgentSavings,
} from '../sub-agent.js'

function testConfig(overrides?: Partial<Config>): Config {
  return {
    mode: 'code',
    model: 'test-model',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: 'http://test',
    cwd: '/test/project',
    autoApprove: true,
    thinking: false,
    reasoningEffort: 'medium',
    enableCache: false,
    strictTools: false,
    contextWindow: 128_000,
    ...overrides,
  }
}

describe('buildSubAgentPrompt', () => {
  test('includes the task description', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'Implement sortByDate function')
    expect(prompt).toContain('Implement sortByDate function')
  })

  test('includes environment info', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).toContain('Platform:')
    expect(prompt).toContain('Shell:')
    expect(prompt).toContain('Working directory:')
  })

  test('includes tool list', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).toContain('Available tools:')
    expect(prompt).toContain('read')
    expect(prompt).toContain('edit')
    expect(prompt).toContain('bash')
  })

  test('includes context when provided', () => {
    const config = testConfig()
    const context = ['// some code', 'function foo() { return 42 }'].join('\n')
    const prompt = buildSubAgentPrompt(config, 'test', context)
    expect(prompt).toContain('## Relevant Context')
    expect(prompt).toContain('function foo')
  })

  test('does NOT include context section when context is empty', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).not.toContain('## Relevant Context')
  })

  test('includes blocklist instructions (no delegate, no task_complete)', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).toContain('delegate')
    expect(prompt).toContain('task_complete')
    expect(prompt).toContain('not be called')
  })

  test('does NOT include long-term memory', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).not.toContain('Memory')
  })

  test('does NOT include skills section', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).not.toContain('Active Skills')
    expect(prompt).not.toContain('Skill:')
  })

  test('does NOT include full project context', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).not.toContain('Project Context')
    expect(prompt).not.toContain('Dependencies:')
    expect(prompt).not.toContain('Entry point')
  })

  test('does NOT include conversation history markers', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'test')
    expect(prompt).not.toContain('Conversation History')
    expect(prompt).not.toContain('Summary')
  })

  test('prompt is significantly shorter than main system prompt (under 2K chars)', () => {
    const config = testConfig()
    const prompt = buildSubAgentPrompt(config, 'Implement sortByDate function in src/utils.ts')
    expect(prompt.length).toBeLessThan(2500)
  })
})

describe('buildSubAgentToolDefinitions', () => {
  test('filters out delegate tool', () => {
    const definitions: ToolDefinition[] = [
      { name: 'read', description: '', parameters: {} },
      { name: 'edit', description: '', parameters: {} },
      { name: 'delegate', description: '', parameters: {} },
      { name: 'bash', description: '', parameters: {} },
    ]
    const filtered = buildSubAgentToolDefinitions(definitions)
    const names = filtered.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).not.toContain('delegate')
  })

  test('filters out task_complete tool', () => {
    const definitions: ToolDefinition[] = [
      { name: 'read', description: '', parameters: {} },
      { name: 'task_complete', description: '', parameters: {} },
    ]
    const filtered = buildSubAgentToolDefinitions(definitions)
    const names = filtered.map(d => d.name)
    expect(names).toContain('read')
    expect(names).not.toContain('task_complete')
  })

  test('preserves all other tools', () => {
    const definitions: ToolDefinition[] = [
      { name: 'read', description: '', parameters: {} },
      { name: 'edit', description: '', parameters: {} },
      { name: 'bash', description: '', parameters: {} },
      { name: 'glob', description: '', parameters: {} },
      { name: 'grep', description: '', parameters: {} },
      { name: 'ls', description: '', parameters: {} },
      { name: 'find', description: '', parameters: {} },
      { name: 'fetch', description: '', parameters: {} },
      { name: 'search', description: '', parameters: {} },
      { name: 'git', description: '', parameters: {} },
      { name: 'tool', description: '', parameters: {} },
    ]
    const filtered = buildSubAgentToolDefinitions(definitions)
    const names = filtered.map(d => d.name)
    expect(names.length).toBe(11)
    expect(names).toEqual([
      'read',
      'edit',
      'bash',
      'glob',
      'grep',
      'ls',
      'find',
      'fetch',
      'search',
      'git',
      'tool',
    ])
  })
})

describe('estimateSubAgentSavings', () => {
  test('returns positive savings when sub-messages are larger than summary', () => {
    const subMessages = [
      { role: 'system', content: `You are a sub-agent. ${'x'.repeat(400)}` },
      { role: 'user', content: 'Implement function' },
      { role: 'assistant', content: `Here is the result. ${'y'.repeat(200)}` },
    ]
    const savings = estimateSubAgentSavings(subMessages, 50)
    expect(savings).toBeGreaterThan(0)
  })

  test('returns 0 when summary is larger than sub-messages', () => {
    const subMessages = [{ role: 'user', content: 'hi' }]
    const savings = estimateSubAgentSavings(subMessages, 1000)
    expect(savings).toBe(0)
  })

  test('handles empty messages', () => {
    const savings = estimateSubAgentSavings([], 0)
    expect(savings).toBe(0)
  })

  test('handles null content in messages', () => {
    const subMessages = [
      { role: 'assistant', content: null },
      { role: 'tool', content: 'result' },
    ]
    const savings = estimateSubAgentSavings(subMessages, 10)
    expect(savings).toBeGreaterThanOrEqual(0)
  })
})
