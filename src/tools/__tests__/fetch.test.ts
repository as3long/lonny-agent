import { describe, expect, it } from 'vitest'
import { fetchTool } from '../fetch.js'

describe('fetch tool', () => {
  it('executes a fetch successfully', async () => {
    const result = await fetchTool.execute({ url: 'https://httpbin.org/get' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('args')
  })

  it('rejects missing url', async () => {
    const result = await fetchTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('url is required')
  })

  it('returns error for invalid url', async () => {
    const result = await fetchTool.execute({ url: 'not-a-valid-url' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Fetch failed')
  })

  it('supports custom timeout', async () => {
    const result = await fetchTool.execute({ url: 'https://httpbin.org/get', timeout: 5000 })
    expect(result.success).toBe(true)
  })

  it('supports custom headers', async () => {
    const result = await fetchTool.execute({
      url: 'https://httpbin.org/headers',
      headers: { 'X-Custom-Header': 'test-value' },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('test-value')
  })
})
