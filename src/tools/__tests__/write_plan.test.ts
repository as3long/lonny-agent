import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWritePlanTool } from '../write_plan.js'
import { makeTempDir } from './helpers.js'

describe('write_plan tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createWritePlanTool(tmpDir)

  it('writes a file under .lonny/', async () => {
    const result = await tool().execute({ filename: 'plan.md', content: '# Plan\n- [ ] step' })
    expect(result.success).toBe(true)
    const written = fs.readFileSync(path.join(tmpDir, '.lonny', 'plan.md'), 'utf8')
    expect(written).toContain('# Plan')
  })

  it('creates nested directories', async () => {
    const result = await tool().execute({ filename: 'feature-x/plan.md', content: 'nested' })
    expect(result.success).toBe(true)
    const written = fs.readFileSync(path.join(tmpDir, '.lonny', 'feature-x', 'plan.md'), 'utf8')
    expect(written).toBe('nested')
  })

  it('strips a leading .lonny/ prefix supplied by the model', async () => {
    const result = await tool().execute({ filename: '.lonny/dup.md', content: 'ok' })
    expect(result.success).toBe(true)
    expect(fs.existsSync(path.join(tmpDir, '.lonny', 'dup.md'))).toBe(true)
  })

  it('rejects path traversal', async () => {
    const result = await tool().execute({ filename: '../escape.md', content: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects absolute paths', async () => {
    const result = await tool().execute({ filename: '/etc/passwd', content: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects missing filename', async () => {
    const result = await tool().execute({ content: 'x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('filename is required')
  })

  it('rejects missing content', async () => {
    const result = await tool().execute({ filename: 'plan.md' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('content is required')
  })

  it('allows empty content', async () => {
    const result = await tool().execute({ filename: 'empty.md', content: '' })
    expect(result.success).toBe(true)
    expect(fs.readFileSync(path.join(tmpDir, '.lonny', 'empty.md'), 'utf8')).toBe('')
  })

  it('rejects "." filename', async () => {
    const result = await tool().execute({ filename: '.', content: 'x' })
    expect(result.success).toBe(false)
  })
})
