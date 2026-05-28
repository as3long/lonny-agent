import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface Config {
  apiKey: string
  baseUrl?: string
  mode: 'code' | 'plan' | 'ask'
  provider: 'openai' | 'anthropic' | 'google' | 'ollama'
  model: string
  cwd: string
  autoApprove: boolean
  thinking?: boolean
  reasoningEffort?: string
  enableCache?: boolean
  strictTools?: boolean
  temperature?: number
  maxTokens?: number
  tavilyApiKey?: string
}

interface JsonConfig {
  apiKey?: string
  baseUrl?: string
  provider?: string
  model?: string
  thinking?: boolean
  reasoningEffort?: string
  autoApprove?: boolean
  enableCache?: boolean
  strictTools?: boolean
  temperature?: number
  maxTokens?: number
  tavilyApiKey?: string
}

let cachedJsonConfig: JsonConfig | null = null

function loadJsonConfig(): JsonConfig {
  if (cachedJsonConfig) return cachedJsonConfig
  const configPath = path.join(os.homedir(), '.lonny', 'config.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    cachedJsonConfig = JSON.parse(raw) as JsonConfig
    return cachedJsonConfig
  } catch {
    cachedJsonConfig = {}
    return cachedJsonConfig
  }
}

/** Check if the model is a DeepSeek model (supports enable_cache). */
function isDeepSeekModel(model: string, baseUrl?: string): boolean {
  if (/deepseek/i.test(model)) return true
  if (baseUrl && /deepseek/i.test(baseUrl)) return true
  return false
}

export function loadConfig(options?: {
  mode?: 'code' | 'plan' | 'ask'
  autoApprove?: boolean
  cwd?: string
}): Config {
  const jsonConfig = loadJsonConfig()

  const model = jsonConfig.model || 'deepseek-v4-flash'
  const baseUrl = process.env.LONNY_BASE_URL || jsonConfig.baseUrl || undefined

  // Auto-enable cache for DeepSeek models unless explicitly disabled
  const enableCache = jsonConfig.enableCache ?? (isDeepSeekModel(model, baseUrl) || undefined)

  return {
    apiKey: jsonConfig.apiKey || '',
    baseUrl,
    provider: (process.env.LONNY_PROVIDER || jsonConfig.provider || 'openai') as
      | 'openai'
      | 'anthropic'
      | 'google'
      | 'ollama',
    mode: options?.mode || 'code',
    model,
    cwd: options?.cwd || process.cwd(),
    autoApprove: options?.autoApprove ?? jsonConfig.autoApprove ?? false,
    thinking: jsonConfig.thinking,
    reasoningEffort: jsonConfig.reasoningEffort,
    enableCache,
    strictTools: jsonConfig.strictTools,
    temperature: jsonConfig.temperature,
    maxTokens: jsonConfig.maxTokens,
    tavilyApiKey: jsonConfig.tavilyApiKey,
  }
}
