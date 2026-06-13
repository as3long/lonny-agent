import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globTool } from '../codebase/glob.js'
import { makeTempDir } from './helpers.js'

describe('glob tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'line1\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(tmpDir, 'sub', 'd.ts'), 'export const y = 2\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds files by pattern', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '*.txt') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
    expect(result.output).toContain('b.txt')
  })

  it('finds files in subdirectories', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '**', '*.ts') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('c.ts')
    expect(result.output).toContain('d.ts')
  })

  it('returns no matches for unmatched pattern', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '*.xyz') })
    expect(result.success).toBe(true)
    expect(result.output).toBe('No files matched the pattern.')
  })

  it('rejects missing pattern', async () => {
    const result = await globTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('pattern is required')
  })
})
