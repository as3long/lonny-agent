import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createReadTool } from '../read.js'
import { PatchApplier } from '../../diff/apply.js'
import { makeTempDir } from './helpers.js'

describe('read tool', () => {
  let tmpDir: string
  let applier: PatchApplier

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\nfoo bar\nbaz qux\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'line1\nline2\nline3\n')
    fs.mkdirSync(path.join(tmpDir, 'empty'))
    applier = new PatchApplier()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = (): ReturnType<typeof createReadTool> => createReadTool(applier, tmpDir)

  it('reads existing files', async () => {
    const result = await tool().execute({ paths: ['a.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('=== a.txt ===')
    expect(result.output).toContain('hello world')
  })

  it('reads multiple files', async () => {
    const result = await tool().execute({ paths: ['a.txt', 'b.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('=== a.txt ===')
    expect(result.output).toContain('=== b.txt ===')
  })

  it('returns error for non-existent file', async () => {
    const result = await tool().execute({ paths: ['nonexistent.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('(error:')
  })

  it('returns error for directory path', async () => {
    const result = await tool().execute({ paths: ['empty'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('not a file')
  })

  it('rejects empty paths', async () => {
    const result = await tool().execute({ paths: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })

  it('rejects missing paths', async () => {
    const result = await tool().execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })

  it('rejects non-array paths', async () => {
    const result = await tool().execute({ paths: 'not-an-array' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })
})
