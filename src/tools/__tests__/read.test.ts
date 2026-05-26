import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createReadTool } from '../read.js'
import { FileReadTracker } from '../../diff/apply.js'
import { makeTempDir } from './helpers.js'

describe('read tool', () => {
  let tmpDir: string
  let applier: FileReadTracker

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\nfoo bar\nbaz qux\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'line1\nline2\nline3\n')
    fs.mkdirSync(path.join(tmpDir, 'empty'))
    applier = new FileReadTracker()
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

  it('prefixes each line with its 1-based line number', async () => {
    const result = await tool().execute({ paths: ['a.txt'] })
    expect(result.output).toContain('1: hello world')
    expect(result.output).toContain('2: foo bar')
    expect(result.output).toContain('3: baz qux')
    // Should not emit a trailing blank "4: " line for the final \n.
    expect(result.output).not.toMatch(/^4: /m)
  })

  it('pads line numbers to a consistent width', async () => {
    const big = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n') + '\n'
    fs.writeFileSync(path.join(tmpDir, 'big.txt'), big)
    const result = await tool().execute({ paths: ['big.txt'] })
    expect(result.output).toContain(' 1: line1')
    expect(result.output).toContain('12: line12')
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
