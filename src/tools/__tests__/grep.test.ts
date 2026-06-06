import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createGrepTool } from '../grep.js'
import { makeTempDir } from './helpers.js'

describe('grep tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(
      path.join(tmpDir, 'hello.ts'),
      'const x = 1\nfunction greet() { return "hello" }\nexport { greet }\n',
    )
    fs.writeFileSync(path.join(tmpDir, 'world.js'), 'const y = 2\nconsole.log("world")\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.ts'), 'const z = 3\n// TODO: implement\n')
    // Additional files for include glob and path parameter tests
    fs.mkdirSync(path.join(tmpDir, 'lib'))
    fs.writeFileSync(path.join(tmpDir, 'lib', 'index.ts'), 'export const version = 1\n')
    fs.writeFileSync(path.join(tmpDir, 'lib', 'helper.tsx'), 'export function helper() {}\n')
    fs.writeFileSync(path.join(tmpDir, 'lib', 'config.tsx'), 'export const config = {}\n')
    fs.writeFileSync(path.join(tmpDir, 'lib', 'readme.md'), '# no code here\n')
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

  it('filters by brace-enclosed glob pattern', async () => {
    const result = await tool().execute({ pattern: 'export', include: '*.{ts,tsx}' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('lib/index.ts')
    expect(result.output).toContain('lib/helper.tsx')
    expect(result.output).toContain('lib/config.tsx')
    // Should NOT match hello.ts (it matches 'export' but is in root, not filtered out)
    // All .ts and .tsx files should be included, including hello.ts which has 'export'
  })

  it('filters by include with path parameter', async () => {
    const result = await tool().execute({
      pattern: 'export',
      include: '*.ts',
      path: tmpDir + '/lib',
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('lib/index.ts')
    // helper.tsx and config.tsx are .tsx, not .ts, so should not appear
    expect(result.output).not.toContain('lib/helper.tsx')
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

  it('handles pattern with alternation', async () => {
    const result = await tool().execute({ pattern: 'TODO|hello' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('deep.ts')
    expect(result.output).toContain('hello.ts')
  })
})
