import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'node:child_process'
import { createGrepTool } from '../grep.js'

describe('grep tool', () => {
  let hasRg: boolean
  beforeAll(() => {
    try {
      execSync('rg --version', { stdio: 'pipe' })
      hasRg = true
    } catch {
      hasRg = false
    }
  })

  const tool = createGrepTool(process.cwd())

  it('finds matching lines', async () => {
    if (!hasRg) return
    const result = await tool.execute({ pattern: 'describe' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('describe')
  })

  it('returns no matches for missing pattern', async () => {
    if (!hasRg) return
    const result = await tool.execute({ pattern: 'zzz_nonexistent_zzz' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('No matches found.')
  })

  it('rejects missing pattern argument', async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('pattern is required')
  })

  it('reports rg not installed gracefully', async () => {
    if (hasRg) return
    const result = await tool.execute({ pattern: 'hello' })
    expect(result.success).toBe(false)
  })
})
