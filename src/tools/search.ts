import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { Tool, ToolResult } from './types.js'

interface TavilyConfig {
  tavilyApiKey?: string
}

// ── Tavily API key cache ──────────────────────────────────────────────────
let _cachedApiKey: string | undefined = undefined

function loadTavilyApiKey(): string | undefined {
  if (_cachedApiKey !== undefined) return _cachedApiKey
  const configPath = path.join(os.homedir(), '.lonny', 'config.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as TavilyConfig
    _cachedApiKey = config.tavilyApiKey || process.env.TAVILY_API_KEY || undefined
    return _cachedApiKey
  } catch {
    _cachedApiKey = process.env.TAVILY_API_KEY || undefined
    return _cachedApiKey
  }
}

const TAVILY_API_URL = 'https://api.tavily.com/search'

export const searchTool: Tool = {
  definition: {
    name: 'search',
    description: 'Search the web using the Tavily search engine. Returns a summary answer and a list of relevant results with titles, URLs, and content snippets.',
    parameters: {
      query: { type: 'string', description: 'The search query', required: true },
      search_depth: { type: 'string', description: 'Search depth: "basic" for quick results, "advanced" for deeper search (default: "basic")', required: false },
      include_answer: { type: 'boolean', description: 'Include a concise AI-generated answer (default: true)', required: false },
      max_results: { type: 'number', description: 'Maximum number of results to return, between 1-20 (default: 5)', required: false },
      topic: { type: 'string', description: 'Search topic: "general" or "news" (default: "general")', required: false },
      days: { type: 'number', description: 'Number of days back to search for news (only when topic is "news"), max 7 (default: 3)', required: false },
    },
  },
  async execute(input): Promise<ToolResult> {
    const apiKey = loadTavilyApiKey()
    if (!apiKey) {
      return {
        success: false,
        output: '',
        error: 'Tavily API key not configured. Set "tavilyApiKey" in ~/.lonny/config.json or set the TAVILY_API_KEY environment variable.',
      }
    }

    const query = input.query as string
    if (!query) {
      return { success: false, output: '', error: 'query is required' }
    }

    const searchDepth = (input.search_depth as string) || 'basic'
    const includeAnswer = input.include_answer !== false // default true
    const maxResults = Math.min(Math.max((input.max_results as number) || 5, 1), 20)
    const topic = (input.topic as string) || 'general'
    const days = input.days !== undefined ? Math.min(Math.max((input.days as number), 1), 7) : undefined

    const body: Record<string, unknown> = {
      api_key: apiKey,
      query,
      search_depth: searchDepth,
      include_answer: includeAnswer,
      include_images: false,
      include_raw_content: false,
      max_results: maxResults,
      topic,
    }

    // Only add days for news topic
    if (topic === 'news' && days !== undefined) {
      body.days = days
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    try {
      const response = await fetch(TAVILY_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error')
        return { success: false, output: '', error: `Tavily API error (${response.status}): ${errText}` }
      }

      const data = (await response.json()) as {
        answer?: string
        results?: Array<{ title: string; url: string; content: string }>
      }

      const results = data.results || []
      let output = ''

      if (data.answer) {
        output += `Answer: ${data.answer}\n\n`
      }

      if (results.length === 0) {
        output += '(no results found)'
      } else {
        const lines = results.map((r, i) => {
          return `[${i + 1}] ${r.title}\n    URL: ${r.url}\n    ${r.content}`
        })
        output += `Results (${results.length}):\n${lines.join('\n\n')}`
      }

      return { success: true, output }
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, output: '', error: 'Tavily search timed out after 30s' }
      }
      return { success: false, output: '', error: `Search failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}