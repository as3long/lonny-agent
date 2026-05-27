import { Tool, ToolResult } from './types.js'

export const fetchTool: Tool = {
  definition: {
    name: 'fetch',
    description: 'Fetch content from a URL. Returns the response body as text.',
    parameters: {
      url: { type: 'string', description: 'URL to fetch', required: true },
      method: { type: 'string', description: 'HTTP method (GET, POST, etc.)', required: false },
      headers: { type: 'object', description: 'Request headers', required: false },
      body: { type: 'string', description: 'Request body for POST/PUT', required: false },
      timeout: { type: 'number', description: 'Timeout in milliseconds', required: false },
    },
  },
  async execute(input): Promise<ToolResult> {
    const url = input.url as string
    if (!url) {
      return { success: false, output: '', error: 'url is required' }
    }

    const method = ((input.method as string) || 'GET').toUpperCase()
    const timeout = (input.timeout as number) || 30_000
    const headers = (input.headers as Record<string, string>) || {}
    const body = input.body as string | undefined

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, { method, headers, body, signal: controller.signal })
      clearTimeout(timeoutId)

      const contentLength = response.headers.get('content-length')
      if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
        return { success: false, output: '', error: 'response too large (>1MB)' }
      }

      const text = await response.text()
      if (text.length > 1_000_000) {
        return { success: false, output: '', error: 'response body too large (>1MB)' }
      }

      return { success: true, output: text }
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, output: '', error: `Request timed out after ${timeout}ms` }
      }
      return { success: false, output: '', error: `Fetch failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}