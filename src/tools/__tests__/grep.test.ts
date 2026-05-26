import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createGrepTool } from '../grep.js'
import { makeTempDir } from './helpers.js'

describe('grep tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'hello.ts'), 'const x = 1\nfunction greet() { return "hello" }\nexport { greet }\n')
    fs.writeFileSync(path.join(tmpDir, 'world.js'), 'const y = 2\nconsole.log("world")\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.ts'), 'const z = 3\n// TODO: implement\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createGrepTool(tmpDir)

  it('finds matching lines', async () => {
    const result = await tool().execute({ pattern: 'hello' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello.ts')
    expect(result.output).toContain('hello')
  })

  it('returns no matches for missing pattern', async () => {
    const result = await tool().execute({ pattern: 'zzz_nonexistent_zzz' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('No matches found.')
  })

  it('filters by include glob', async () => {
    const result = await tool().execute({ pattern: 'const', include: '*.ts' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello.ts')
    expect(result.output).not.toContain('world.js')
  })

  it('rejects missing pattern argument', async () => {
    const result = await tool().execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('pattern is required')
  })

  it('works without rg installed', async () => {
    const result = await tool().execute({ pattern: 'TODO' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('deep.ts')
  })
})
