import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileReadTracker } from '../../diff/apply.js'
import { ToolRegistry } from '../registry.js'
import { makeTempDir } from './helpers.js'

describe('ToolRegistry', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('registers tools in code mode', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('ls')
    expect(names).toContain('bash')
    expect(names).toContain('edit')
    expect(names).toContain('fetch')
    expect(names).not.toContain('write_plan')
  })

  it('excludes edit in plan mode and includes write_plan', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'plan',
    })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).not.toContain('edit')
    expect(names).toContain('write_plan')
    expect(names).toContain('fetch')
  })

  it('registers all tools in loop mode (same as code)', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'loop',
    })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('ls')
    expect(names).toContain('bash')
    expect(names).toContain('edit')
    expect(names).toContain('fetch')
    expect(names).toContain('search')
    expect(names).toContain('find')
    expect(names).toContain('git')
    expect(names).toContain('install_skill')
    expect(names).not.toContain('write_plan')
  })

  it('setMode handles loop mode correctly', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    reg.setMode('loop')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).toContain('read')
    expect(names).not.toContain('write_plan')
  })

  it('setMode adds edit when switching to code', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'plan',
    })
    reg.setMode('code')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).toContain('edit')
    expect(names).not.toContain('write_plan')
  })

  it('setMode removes edit when switching to plan', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    reg.setMode('plan')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).not.toContain('edit')
    expect(names).toContain('write_plan')
  })

  it('dispatches to correct tool', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({ id: '1', name: 'ls', input: {} })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
  })

  it('returns error for unknown tool', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({ id: '1', name: 'nonexistent', input: {} })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })

  // ── Tiered access tests ──────────────────────────────────────────────

  it('getCoreDefinitions returns only core tools + gateway in code mode', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const core = reg.getCoreDefinitions()
    const names = core.map(d => d.name)
    // Core tools
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('bash')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('task_complete')
    // Gateway tool
    expect(names).toContain('tool')
    // Extended tools should NOT be in core
    expect(names).not.toContain('ls')
    expect(names).not.toContain('find')
    expect(names).not.toContain('git')
    expect(names).not.toContain('fetch')
    expect(names).not.toContain('search')
    expect(names).not.toContain('install_skill')
    expect(names).not.toContain('write_plan')
    expect(names).not.toContain('save_memory')
    expect(names).not.toContain('list_memory')
    expect(names).not.toContain('delete_memory')
    // Exactly 7 tools in core set (6 core + 1 gateway)
    expect(names.length).toBe(7)
  })

  it('getDefinitions still returns all tools including extended ones', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const all = reg.getDefinitions()
    const names = all.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('ls')
    expect(names).toContain('find')
    expect(names).toContain('git')
    expect(names).toContain('fetch')
    expect(names).toContain('tool') // gateway is always in the registry
    expect(names.length).toBeGreaterThan(6)
  })

  it('tool() gateway dispatches to an extended tool (ls)', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    // Simulate what the LLM would do: call tool({ name: "ls", params: { path: tmpDir } })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'ls', params: { path: tmpDir } },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
  })

  it('tool() gateway rejects recursive call', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'tool', params: {} },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('recursively')
  })

  it('tool() gateway rejects missing name', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { params: {} },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('name')
  })

  it('getCoreDefinitions returns core-only in plan mode', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'plan',
    })
    const core = reg.getCoreDefinitions()
    const names = core.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('tool')
    // write_plan is extended → not in core
    expect(names).not.toContain('write_plan')
    // edit is not in plan mode at all
    expect(names).not.toContain('edit')
  })

  it('getCoreDefinitions returns only fetch/search in ask mode', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'ask',
    })
    const core = reg.getCoreDefinitions()
    const names = core.map(d => d.name)
    expect(names).toContain('fetch')
    expect(names).toContain('search')
    expect(names).not.toContain('read')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('tool') // ask mode doesn't need the gateway
  })

  // ── Gateway + core tool integration tests ────────────────────────────

  it('tool() gateway dispatches edit with markdown format', async () => {
    const file = path.join(tmpDir, 'gateway-edit.txt')
    fs.writeFileSync(file, 'hello world\n')
    const applier = new FileReadTracker()
    applier.markRead(file)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const input = '```edit\nfile: gateway-edit.txt\nold: |\nhello world\nnew: |\nHELLO WORLD\n```'
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'edit', params: { content: input } },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('HELLO WORLD')
    expect(fs.readFileSync(file, 'utf8')).toBe('HELLO WORLD\n')
  })

  it('tool() gateway dispatches edit with legacy JSON format', async () => {
    const file = path.join(tmpDir, 'gateway-edit-json.txt')
    fs.writeFileSync(file, 'foo bar\n')
    const applier = new FileReadTracker()
    applier.markRead(file)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: {
        name: 'edit',
        params: {
          edits: [
            { file_path: 'gateway-edit-json.txt', old_string: 'foo bar', new_string: 'FOO BAR' },
          ],
        },
      },
    })
    expect(result.success).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('FOO BAR\n')
  })

  it('tool() gateway dispatches bash with string param (normalization)', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    // When params is a bare string, normalizeToolInput wraps it into { command: <string> }
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'bash', params: 'echo gateway-test' },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('gateway-test')
  })

  it('tool() gateway dispatches bash with object param', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'bash', params: { command: 'echo obj-param-test' } },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('obj-param-test')
  })

  it('tool() gateway dispatches read with array params (normalization)', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    // Array params get normalized: ["a.txt"] → { paths: ["a.txt"], path: "a.txt" }
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: {
        name: 'read',
        params: { paths: [path.relative(tmpDir, path.join(tmpDir, 'a.txt'))] },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
  })

  it('tool() gateway reports error for unknown extended tool', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'gateway-test',
      name: 'tool',
      input: { name: 'nonexistent_tool', params: {} },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })

  it('direct dispatch to edit still works (unchanged)', async () => {
    const file = path.join(tmpDir, 'direct-edit.txt')
    fs.writeFileSync(file, 'direct\n')
    const applier = new FileReadTracker()
    applier.markRead(file)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'direct',
      name: 'edit',
      input: {
        edits: [{ file_path: 'direct-edit.txt', old_string: 'direct', new_string: 'EDITED' }],
      },
    })
    expect(result.success).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('EDITED\n')
  })

  it('setMode retains gateway tool after mode switch', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    expect(reg.getCoreDefinitions().map(d => d.name)).toContain('tool')
    reg.setMode('plan')
    expect(reg.getCoreDefinitions().map(d => d.name)).toContain('tool')
    reg.setMode('loop')
    expect(reg.getCoreDefinitions().map(d => d.name)).toContain('tool')
  })
})
