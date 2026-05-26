import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { ToolRegistry } from '../registry.js'
import { PatchApplier } from '../../diff/apply.js'
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
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('ls')
    expect(names).toContain('bash')
    expect(names).toContain('edit')
    expect(names).toContain('batch_edit')
    expect(names).not.toContain('write_plan')
  })

  it('excludes batch_edit and edit in plan mode and includes write_plan', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'plan' })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).not.toContain('edit')
    expect(names).not.toContain('batch_edit')
    expect(names).toContain('write_plan')
  })

  it('setMode adds edit and batch_edit when switching to code', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'plan' })
    reg.setMode('code')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).toContain('edit')
    expect(names).toContain('batch_edit')
    expect(names).not.toContain('write_plan')
  })

  it('setMode removes edit and batch_edit when switching to plan', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    reg.setMode('plan')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).not.toContain('edit')
    expect(names).not.toContain('batch_edit')
    expect(names).toContain('write_plan')
  })

  it('dispatches to correct tool', async () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const result = await reg.dispatch({ id: '1', name: 'ls', input: {} })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
  })

  it('returns error for unknown tool', async () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const result = await reg.dispatch({ id: '1', name: 'nonexistent', input: {} })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })
})
