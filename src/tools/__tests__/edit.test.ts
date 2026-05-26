import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createEditTool } from '../edit.js'
import { PatchApplier } from '../../diff/apply.js'
import { makeTempDir } from './helpers.js'

describe('edit tool', () => {
  let tmpDir: string
  let applier: PatchApplier

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'target.txt'), 'line one\nline two\nline three\nline four\nline five\n')
    fs.writeFileSync(path.join(tmpDir, 'single.txt'), 'only line\n')
    applier = new PatchApplier()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  it('replaces an exact string in a file', async () => {
    const result = await tool().execute({
      file_path: 'target.txt',
      old_string: 'line two',
      new_string: 'line TWO',
    })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(path.join(tmpDir, 'target.txt'), 'utf8')
    expect(content).toContain('line TWO')
    expect(content).toContain('line one')
    expect(content).toContain('line three')
  })

  it('replaces a multi-line string', async () => {
    const result = await tool().execute({
      file_path: 'target.txt',
      old_string: 'line one\nline TWO',
      new_string: 'line 1\nline 2',
    })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(path.join(tmpDir, 'target.txt'), 'utf8')
    expect(content).toContain('line 1')
    expect(content).toContain('line 2')
    expect(content).toContain('line three')
  })

  it('reports when old_string is not found', async () => {
    const result = await tool().execute({
      file_path: 'target.txt',
      old_string: 'this does not exist',
      new_string: 'anything',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('reports when old_string appears multiple times', async () => {
    fs.writeFileSync(path.join(tmpDir, 'dup.txt'), 'abc\ndef\nabc\n')
    const result = await tool().execute({
      file_path: 'dup.txt',
      old_string: 'abc',
      new_string: 'xyz',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('MULTIPLE times')
  })

  it('rejects missing file_path', async () => {
    const result = await tool().execute({ old_string: 'x', new_string: 'y' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('file_path is required')
  })

  it('rejects missing old_string', async () => {
    const result = await tool().execute({ file_path: 'x', new_string: 'y' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('old_string is required')
  })

  it('reports file not found', async () => {
    const result = await tool().execute({
      file_path: 'nonexistent.txt',
      old_string: 'x',
      new_string: 'y',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})
