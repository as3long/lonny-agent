import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export interface Config {
  apiKey: string
  baseUrl?: string
  mode: 'code' | 'plan'
  provider: 'openai' | 'anthropic'
  model: string
  cwd: string
  autoApprove: boolean
  thinking?: boolean
  reasoningEffort?: string
  enableCache?: boolean
}

interface JsonConfig {
  apiKey?: string
  baseUrl?: string
  provider?: string
  model?: string
  thinking?: boolean
  reasoningEffort?: string
  enableCache?: boolean
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

export function loadConfig(options: Partial<Config>): Config {
  const jsonConfig = loadJsonConfig()

  const model = options.model || process.env.LONNY_MODEL || jsonConfig.model || 'claude-sonnet-4-20250514'
  const baseUrl = options.baseUrl || process.env.LONNY_BASE_URL || jsonConfig.baseUrl || undefined

  // Auto-enable cache for DeepSeek models unless explicitly disabled
  const enableCache = options.enableCache ?? jsonConfig.enableCache ?? (isDeepSeekModel(model, baseUrl) || undefined)

  return {
    apiKey: options.apiKey || process.env.LONNY_API_KEY || jsonConfig.apiKey || '',
    baseUrl,
    provider: (options.provider || process.env.LONNY_PROVIDER || jsonConfig.provider || 'anthropic') as 'openai' | 'anthropic',
    mode: options.mode || 'code',
    model,
    cwd: options.cwd || process.cwd(),
    autoApprove: options.autoApprove ?? false,
    thinking: options.thinking ?? jsonConfig.thinking,
    reasoningEffort: options.reasoningEffort || jsonConfig.reasoningEffort,
    enableCache,
  }
}