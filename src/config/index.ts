import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export interface Config {
  apiKey: string
  baseUrl?: string
  mode: 'code' | 'plan' | 'ask' | 'loop' | 'review'
  provider: 'openai' | 'anthropic' | 'google' | 'ollama'
  model: string
  contextWindow: number
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

/**
 * 模型上下文窗口大小映射表（基于 2026 年最新数据）
 * 单位：tokens
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Doubao 系列
  'doubao-seed-2.0-code': 256_000,
  'doubao-seed-2.0-pro': 256_000,
  'doubao-seed-2.0-lite': 256_000,
  'doubao-seed-2.0-mini': 256_000,
  'doubao-seed-2.0-code-preview-260215': 256_000,
  'doubao-seed-1.8': 256_000,
  'doubao-seed-1.6': 256_000,

  // DeepSeek 系列
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 256_000,
  'deepseek-v3.2': 160_000,
  'deepseek-r1': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,

  // Kimi 系列
  'kimi-k2.5': 262_144,
  'kimi-k2.6': 262_144,
  'kimi-k2-thinking': 256_000,

  // MiniMax 系列
  'minimax-m2.5': 200_000,
  'minimax-m2.7': 200_000,
  'minimax-m2': 205_000,

  // GLM 系列
  'glm-5': 200_000,
  'glm-5.1': 200_000,
  'glm-4.7-flashx': 200_000,
  'glm-4-flash': 128_000,
  'glm-4': 128_000,

  // Qwen 系列
  'qwen3.6-plus': 1_000_000,
  'qwen3.7-max': 1_000_000,
  'qwen3-max': 256_000,
  'qwen3.5-plus': 1_000_000,
  'qwen-flash': 1_000_000,

  // Claude 系列
  'claude-opus-4.7': 1_000_000,
  'claude-opus-4.6': 1_000_000,
  'claude-sonnet-4.6': 1_000_000,
  'claude-haiku-4.5': 200_000,

  // GPT 系列
  'gpt-5.5': 1_000_000,
  'gpt-5.4': 1_000_000,
  'gpt-5.1': 1_000_000,
  'gpt-5.2-codex': 512_000,
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4o': 128_000,
  'gpt-4': 128_000,

  // Gemini 系列
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-3.1-pro': 1_000_000,
  'gemini-3.1-flash': 1_000_000,

  // Llama 系列
  'llama-4-maverick': 1_000_000,
  'llama-4-scout': 10_000_000,
  'llama-3.1': 128_000,
  'llama-3': 128_000,

  // Mistral 系列
  'mistral-small-3.1': 128_000,
  'mistral-small-3.2': 128_000,
}

/**
 * 模糊匹配规则
 */
interface FuzzyMatchRule {
  keywords: string[]
  windowSize: number
}

/**
 * 模糊匹配规则列表（从高优先级到低优先级）
 */
const fuzzyMatchRules: FuzzyMatchRule[] = [
  // 首先匹配 128K 模型（防止 gpt-4 匹配到 gpt-5 规则）
  {
    keywords: [
      'gpt-4o',
      'gpt 4o',
      'gpt-4',
      'gpt 4',
      'llama-3',
      'llama 3',
      'mistral-small',
      'mistral small',
      'glm-4-flash',
      'glm 4 flash',
      'glm-4',
    ],
    windowSize: 128_000,
  },
  // 百万上下文模型 - 更高优先级（更精确的关键词）
  {
    keywords: [
      'deepseek-v4',
      'deepseek v4',
      'qwen3.6',
      'qwen 3.6',
      'qwen3.7',
      'qwen 3.7',
      'qwen3.5',
      'qwen 3.5',
      'qwen-flash',
      'qwen flash',
    ],
    windowSize: 1_000_000,
  },
  {
    keywords: [
      'claude-opus',
      'claude sonnet',
      'claude-sonnet',
      'gpt-5.',
      'gpt 5',
      'gpt-4.1',
      'gpt 4.1',
      'gemini-2.5',
      'gemini 2.5',
      'gemini-3.1',
      'gemini 3.1',
      'llama-4',
      'llama 4',
    ],
    windowSize: 1_000_000,
  },
  // 256K 上下文模型
  {
    keywords: [
      'doubao-seed-2.0',
      'doubao seed 2.0',
      'doubao-seed-1',
      'doubao seed 1',
      'kimi-k2',
      'kimi k2',
      'kimi-k2.5',
      'kimi k2.5',
      'kimi-k2.6',
      'kimi k2.6',
      'qwen3',
      'qwen 3',
      'qwen3-max',
      'qwen3 max',
    ],
    windowSize: 256_000,
  },
  // 200K 上下文模型
  {
    keywords: [
      'minimax',
      'glm-5',
      'glm 5',
      'glm-5.1',
      'glm 5.1',
      'glm-4.7',
      'glm 4.7',
      'claude-haiku',
      'claude haiku',
    ],
    windowSize: 200_000,
  },
  // 160K 上下文模型
  {
    keywords: ['deepseek-v3', 'deepseek v3', 'deepseek-v3.2', 'deepseek v3.2'],
    windowSize: 160_000,
  },
  // 最后匹配通用关键词（deepseek）
  {
    keywords: ['deepseek'],
    windowSize: 128_000,
  },
]

/**
 * 根据模型名称获取上下文窗口大小（改进的模糊匹配）
 * @param modelName 模型名称（不区分大小写）
 * @returns 上下文窗口大小（tokens）
 */
export function getContextWindowForModel(modelName: string): number {
  // 处理空字符串
  if (!modelName) {
    return 128_000
  }

  const normalizedModelName = modelName.toLowerCase().replace(/[-_]/g, ' ')

  // 1. 精确匹配（原始键名）
  if (MODEL_CONTEXT_WINDOWS[modelName]) {
    return MODEL_CONTEXT_WINDOWS[modelName]
  }

  // 2. 精确匹配（小写键名）
  if (MODEL_CONTEXT_WINDOWS[modelName.toLowerCase()]) {
    return MODEL_CONTEXT_WINDOWS[modelName.toLowerCase()]
  }

  // 3. 前缀匹配（支持部分匹配）
  for (const [pattern, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    const normalizedPattern = pattern.toLowerCase().replace(/[-_]/g, ' ')
    if (
      normalizedModelName.includes(normalizedPattern) ||
      normalizedPattern.includes(normalizedModelName)
    ) {
      return size
    }
  }

  // 4. 模糊匹配（关键词匹配）- 按照规则顺序（优先级）处理
  for (const rule of fuzzyMatchRules) {
    for (const keyword of rule.keywords) {
      const normalizedKeyword = keyword.toLowerCase().replace(/[-_]/g, ' ')
      if (normalizedModelName.includes(normalizedKeyword)) {
        return rule.windowSize
      }
    }
  }

  // 5. 兜底默认值
  return 128_000
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
  contextWindow?: number
  temperature?: number
  maxTokens?: number
  tavilyApiKey?: string
}

let cachedJsonConfig: JsonConfig | null = null

export function loadJsonConfig(): JsonConfig {
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

export function saveJsonConfig(config: JsonConfig): void {
  const configPath = path.join(os.homedir(), '.lonny', 'config.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  cachedJsonConfig = config
}

/** Check if the model is a DeepSeek model (supports enable_cache). */
function isDeepSeekModel(model: string, baseUrl?: string): boolean {
  if (/deepseek/i.test(model)) return true
  if (baseUrl && /deepseek/i.test(baseUrl)) return true
  return false
}

export function loadConfig(options?: {
  mode?: 'code' | 'plan' | 'ask' | 'loop' | 'review'
  autoApprove?: boolean
  cwd?: string
}): Config {
  const jsonConfig = loadJsonConfig()

  const model = jsonConfig.model || 'deepseek-v4-flash'
  const baseUrl = process.env.LONNY_BASE_URL || jsonConfig.baseUrl || undefined
  const provider = (process.env.LONNY_PROVIDER || jsonConfig.provider || 'openai') as
    | 'openai'
    | 'anthropic'
    | 'google'
    | 'ollama'

  // Auto-enable cache for DeepSeek models unless explicitly disabled
  const enableCache = jsonConfig.enableCache ?? (isDeepSeekModel(model, baseUrl) || undefined)

  // 根据模型名称获取上下文窗口大小，如果配置中有则优先使用配置值
  const contextWindow = jsonConfig.contextWindow || getContextWindowForModel(model)

  return {
    apiKey: jsonConfig.apiKey || '',
    baseUrl,
    provider,
    mode: options?.mode || 'code',
    model,
    contextWindow,
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
