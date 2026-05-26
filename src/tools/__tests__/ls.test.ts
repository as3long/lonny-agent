import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createLsTool } from '../ls.js'
import { makeTempDir } from './helpers.js'

describe('ls tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'x\n')
    fs.writeFileSync(path.join(tmpDir, 'sub', 'd.ts'), 'y\n')
    fs.mkdirSync(path.join(tmpDir, 'empty'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createLsTool(tmpDir)

  it('lists directory contents', async () => {
    const result = await tool().execute({})
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
    expect(result.output).toContain('b.txt')
    expect(result.output).toContain('sub/')
    expect(result.output).toContain('empty/')
  })

  it('lists subdirectory', async () => {
    const result = await tool().execute({ path: 'sub' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('c.ts')
    expect(result.output).toContain('d.ts')
  })

  it('returns error for invalid path', async () => {
    const result = await tool().execute({ path: '/nonexistent_path_xyz' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to list directory')
  })

  it('lists empty directory', async () => {
    const result = await tool().execute({ path: 'empty' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('')
  })
})
