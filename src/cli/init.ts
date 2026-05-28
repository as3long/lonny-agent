import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'

// ── Colors ────────────────────────────────────────────────────────────────────

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const MG = '\x1b[35m'
const GY = '\x1b[90m'
const BLD = '\x1b[1m'
const RS = '\x1b[0m'

// ── Provider definitions ──────────────────────────────────────────────────────

interface ProviderInfo {
  label: string
  models: string[]
  defaultModel: string
  needsBaseUrl: boolean
  baseUrlHint: string
}

const PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    models: [
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-20250514-zh',
      'claude-sonnet-4-20250515',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    needsBaseUrl: false,
    baseUrlHint: 'https://api.anthropic.com',
  },
  openai: {
    label: 'DeepSeek / OpenAI Compatible',
    models: [
      'deepseek-v4-flash',
      'deepseek-reasoner',
      'deepseek-chat',
      'gpt-4o',
      'gpt-4o-mini',
      'o3-mini',
    ],
    defaultModel: 'deepseek-v4-flash',
    needsBaseUrl: true,
    baseUrlHint: 'https://api.deepseek.com (or other OpenAI-compatible endpoint)',
  },
  google: {
    label: 'Google (Gemini)',
    models: ['gemini-2.5-pro-exp-03-25', 'gemini-2.0-flash-001', 'gemini-2.0-flash-lite-001'],
    defaultModel: 'gemini-2.5-pro-exp-03-25',
    needsBaseUrl: false,
    baseUrlHint: 'https://generativelanguage.googleapis.com',
  },
  ollama: {
    label: 'Ollama (Local)',
    models: ['llama3.1', 'qwen2.5-coder', 'mistral', 'codellama', 'deepseek-coder-v2'],
    defaultModel: 'qwen2.5-coder:14b',
    needsBaseUrl: true,
    baseUrlHint: 'http://localhost:11434/v1',
  },
}

// ── Config helpers ────────────────────────────────────────────────────────────

interface JsonConfig {
  apiKey?: string
  baseUrl?: string
  provider?: string
  model?: string
  thinking?: boolean
  reasoningEffort?: string
  enableCache?: boolean
  strictTools?: boolean
  temperature?: number
  maxTokens?: number
  tavilyApiKey?: string
}

function getConfigPath(): string {
  return path.join(os.homedir(), '.lonny', 'config.json')
}

function readExistingConfig(): JsonConfig {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    return JSON.parse(raw) as JsonConfig
  } catch {
    return {}
  }
}

function writeConfig(config: JsonConfig): void {
  const configDir = path.join(os.homedir(), '.lonny')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

// ── Readline helpers ──────────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

async function ask(
  rl: readline.Interface,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const defaultStr = defaultValue ? ` ${GY}[${defaultValue}]${RS}` : ''
  return new Promise(resolve => {
    rl.question(`  ${CY}?${RS} ${question}${defaultStr} `, answer => {
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

async function askConfirm(
  rl: readline.Interface,
  question: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(rl, `${question} ${GY}(${hint})${RS}`, defaultYes ? 'y' : 'n')
  return answer.toLowerCase() === 'y' || (answer === '' && defaultYes)
}

async function askNumber(
  rl: readline.Interface,
  question: string,
  defaultValue?: number,
): Promise<number | undefined> {
  const answer = await ask(
    rl,
    question,
    defaultValue !== undefined ? String(defaultValue) : undefined,
  )
  if (!answer) return undefined
  const n = Number.parseFloat(answer)
  return Number.isNaN(n) ? defaultValue : n
}

// ── Provider selection ────────────────────────────────────────────────────────

async function selectProvider(rl: readline.Interface, current?: string): Promise<string> {
  const keys = Object.keys(PROVIDERS)
  console.log()
  console.log(`  ${BLD}Select a provider:${RS}`)
  for (const [i, key] of keys.entries()) {
    const info = PROVIDERS[key]
    const marker = key === current ? ` ${GR}★${RS}` : '  '
    console.log(`    ${i + 1}.${marker} ${info.label} ${GY}(${key})${RS}`)
  }
  console.log()

  const currentIdx = current ? keys.indexOf(current) + 1 : -1
  const defaultStr = currentIdx > 0 ? String(currentIdx) : '1'
  const answer = await ask(rl, `Enter number ${GY}[1-${keys.length}]${RS}`, defaultStr)
  const idx = Number.parseInt(answer, 10) - 1
  if (idx >= 0 && idx < keys.length) return keys[idx]
  // Fallback: treat as key name
  if (keys.includes(answer)) return answer
  return keys[0]
}

// ── Model selection ───────────────────────────────────────────────────────────

async function selectModel(
  rl: readline.Interface,
  provider: string,
  current?: string,
): Promise<string> {
  const info = PROVIDERS[provider]
  if (!info) {
    return await ask(rl, 'Model name', current || 'deepseek-v4-flash')
  }

  console.log()
  console.log(`  ${BLD}Select a model:${RS}`)
  console.log(`    ${GY}Suggested models for ${info.label}:${RS}`)
  for (const [i, m] of info.models.entries()) {
    const marker = m === current ? ` ${GR}★${RS}` : '  '
    console.log(`    ${i + 1}.${marker} ${m}`)
  }
  console.log(`    ${info.models.length + 1}. ${GY}(custom)${RS}`)
  console.log()

  const currentIdx = current ? info.models.indexOf(current) + 1 : -1
  const defaultStr = currentIdx > 0 ? String(currentIdx) : '1'
  const answer = await ask(
    rl,
    `Enter number or custom name${current ? ` ${GY}[${current}]${RS}` : ''}`,
    defaultStr,
  )

  if (!answer) return current || info.defaultModel
  const idx = Number.parseInt(answer, 10) - 1
  if (idx >= 0 && idx < info.models.length) return info.models[idx]
  if (idx === info.models.length) {
    return (
      (await ask(rl, 'Enter custom model name', current || info.defaultModel)) ||
      current ||
      info.defaultModel
    )
  }
  // Treat as direct model name
  return answer
}

// ── Main init wizard ──────────────────────────────────────────────────────────

export async function runInit(): Promise<void> {
  const existing = readExistingConfig()
  const hasExisting = Object.keys(existing).length > 0

  console.log()
  console.log(`  ${BLD}${CY}╭────────────────────────────────╮${RS}`)
  console.log(`  ${BLD}${CY}│${RS}  ${BLD}Lonny Configuration Wizard${RS}   ${BLD}${CY}│${RS}`)
  console.log(`  ${BLD}${CY}╰────────────────────────────────╯${RS}`)
  console.log()

  if (hasExisting) {
    console.log(`  ${GY}Found existing config at:${RS} ${getConfigPath()}`)
    console.log(`  ${GY}Press Enter to keep current values.${RS}`)
    console.log()
  }

  const rl = createRl()

  try {
    // ── Step 1: Provider ──
    const provider = await selectProvider(rl, existing.provider)

    // ── Step 2: Model ──
    const model = await selectModel(rl, provider, existing.model)

    // ── Step 3: API Key ──
    const apiKey = await ask(rl, `API Key ${YE}(required)${RS}`, existing.apiKey)

    // ── Step 4: Base URL (if needed or optional) ──
    const info = PROVIDERS[provider]
    let baseUrl = existing.baseUrl || ''
    if (info?.needsBaseUrl || existing.baseUrl) {
      baseUrl = await ask(
        rl,
        `Base URL ${GY}(optional)${RS}`,
        baseUrl || info?.baseUrlHint || 'https://api.openai.com/v1',
      )
    }

    // ── Step 5: Thinking (for reasoning models) ──
    const enableThinking = await askConfirm(
      rl,
      'Enable thinking/reasoning?',
      existing.thinking ?? (provider === 'openai' || provider === 'anthropic'),
    )

    let reasoningEffort = existing.reasoningEffort || ''
    if (enableThinking) {
      console.log()
      console.log(`  ${BLD}Reasoning effort:${RS}`)
      console.log(`    1. low`)
      console.log(`    2. medium ${GY}(default)${RS}`)
      console.log(`    3. high`)
      console.log()
      const effortAnswer = await ask(rl, 'Enter number', existing.reasoningEffort || '2')
      const effortMap: Record<string, string> = { '1': 'low', '2': 'medium', '3': 'high' }
      reasoningEffort = effortMap[effortAnswer] || effortAnswer
    }

    // ── Step 6: Temperature ──
    const temperature = await askNumber(rl, 'Temperature (0-2, default: 0)', existing.temperature)

    // ── Step 7: Max Tokens ──
    const maxTokens = await askNumber(rl, 'Max tokens per response', existing.maxTokens)

    // ── Step 8: Tavily API Key (for web search) ──
    const tavilyApiKey = await ask(
      rl,
      `Tavily API key for web search ${GY}(optional)${RS}`,
      existing.tavilyApiKey,
    )

    // ── Build config ──
    const config: JsonConfig = {
      apiKey: apiKey || undefined,
      baseUrl: baseUrl || undefined,
      provider,
      model,
      thinking: enableThinking || undefined,
      reasoningEffort: reasoningEffort || undefined,
      temperature: temperature !== undefined ? Number(temperature.toFixed(2)) : undefined,
      maxTokens: maxTokens !== undefined ? Math.floor(maxTokens) : undefined,
      tavilyApiKey: tavilyApiKey || undefined,
      enableCache: existing.enableCache,
      strictTools: existing.strictTools,
    }

    // ── Confirm ──
    console.log()
    console.log(`  ${BLD}${GR}Configuration summary:${RS}`)
    console.log(`  ${GY}─────────────────────────────${RS}`)
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null && value !== '') {
        const display =
          key === 'apiKey'
            ? `${String(value).slice(0, 8)}...${String(value).slice(-4)}`
            : String(value)
        console.log(`  ${key}: ${BLD}${display}${RS}`)
      }
    }
    console.log()

    const confirmed = await askConfirm(rl, 'Save this configuration?', true)
    if (!confirmed) {
      console.log(`\n  ${YE}Configuration cancelled.${RS}\n`)
      return
    }

    // ── Write ──
    writeConfig(config)
    console.log(`\n  ${GR}✔${RS} Configuration saved to ${BLD}${getConfigPath()}${RS}`)
    console.log()

    if (!config.apiKey) {
      console.log(`  ${YE}⚠${RS} ${BLD}No API key set.${RS} You can set it via:`)
      console.log(`    • Re-run ${BLD}lonny init${RS}`)
      console.log(`    • Edit ${BLD}${getConfigPath()}${RS} manually`)
      console.log()
    }
  } finally {
    rl.close()
  }
}
