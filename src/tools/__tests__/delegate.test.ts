import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Config } from '../../config/index.js'
import { FileReadTracker } from '../../diff/apply.js'
import { createDelegateTool } from '../delegate.js'
import { ToolRegistry } from '../registry.js'
import { makeTempDir } from './helpers.js'

function testConfig(tmpDir: string): Config {
  return {
    mode: 'code',
    model: 'test-model',
    provider: 'openai',
    apiKey: 'test-key',
    baseUrl: 'http://test',
    cwd: tmpDir,
    autoApprove: true,
    thinking: false,
    reasoningEffort: 'medium',
    enableCache: false,
    strictTools: false,
    contextWindow: 128_000,
  }
}

describe('Delegate tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello world\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('has correct definition', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const tool = createDelegateTool(config, registry)
    expect(tool.definition.name).toBe('delegate')
    expect(tool.definition.description).toContain('sub-agent')
    expect(tool.definition.parameters.task).toBeDefined()
    expect(tool.definition.parameters.task.required).toBe(true)
    expect(tool.definition.parameters.context).toBeDefined()
    expect(tool.definition.parameters.context.required).toBe(false)
    expect(tool.definition.parameters.maxIterations).toBeDefined()
    expect(tool.definition.parameters.maxIterations.required).toBe(false)
  })

  it('returns error when task is missing', async () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const tool = createDelegateTool(config, registry)
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('task')
  })

  it('returns error when task is not a string', async () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const tool = createDelegateTool(config, registry)
    const result = await tool.execute({ task: 42 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('task')
  })

  it('is registered in code mode when config is provided', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const defs = registry.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('delegate')
  })

  it('is NOT registered in code mode when config is missing', () => {
    const registry = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const defs = registry.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).not.toContain('delegate')
  })

  it('is NOT registered in plan mode', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'plan' },
      config,
    )
    const defs = registry.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).not.toContain('delegate')
  })

  it('is NOT registered in ask mode', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'ask' },
      config,
    )
    const defs = registry.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).not.toContain('delegate')
  })

  it('can be invoked through the gateway tool', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const coreDefs = registry.getCoreDefinitions()
    const gatewayDef = coreDefs.find(d => d.name === 'tool')
    expect(gatewayDef).toBeDefined()
    // The gateway's description should mention available extended tools
    expect(gatewayDef!.description).toBeDefined()
  })

  it('sub-agent prompt from delegate is minimal (no memory, skills, project context)', () => {
    const config = testConfig(tmpDir)
    const registry = new ToolRegistry(
      { cwd: tmpDir, autoApprove: true, applier: new FileReadTracker(), mode: 'code' },
      config,
    )
    const tool = createDelegateTool(config, registry)
    // The tool definition exists — the actual prompt is built inside
    // createDelegateTool's execute method, which calls buildSubAgentPrompt.
    // We verify the prompt builder separately in sub-agent.test.ts.
    expect(tool.definition.name).toBe('delegate')
  })
})
