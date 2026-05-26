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
}

interface JsonConfig {
  apiKey?: string
  baseUrl?: string
  provider?: string
  model?: string
  thinking?: boolean
  reasoningEffort?: string
}

function loadJsonConfig(): JsonConfig {
  const configPath = path.join(os.homedir(), '.lonny', 'config.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as JsonConfig
  } catch {
    return {}
  }
}

export function loadConfig(options: Partial<Config>): Config {
  const jsonConfig = loadJsonConfig()

  return {
    apiKey: options.apiKey || process.env.LONNY_API_KEY || jsonConfig.apiKey || '',
    baseUrl: options.baseUrl || process.env.LONNY_BASE_URL || jsonConfig.baseUrl || undefined,
    provider: (options.provider || process.env.LONNY_PROVIDER || jsonConfig.provider || 'anthropic') as 'openai' | 'anthropic',
    mode: (options.mode || process.env.LONNY_MODE as 'code' | 'plan' || 'code'),
    model: options.model || process.env.LONNY_MODEL || jsonConfig.model || 'claude-sonnet-4-20250514',
    cwd: options.cwd || process.cwd(),
    autoApprove: options.autoApprove ?? false,
    thinking: options.thinking ?? jsonConfig.thinking,
    reasoningEffort: options.reasoningEffort || jsonConfig.reasoningEffort,
  }
}