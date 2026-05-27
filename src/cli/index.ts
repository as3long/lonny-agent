import { Config, loadConfig } from '../config/index.js'

export function parseArgs(argv: string[]): { config: Config; prompt?: string } {
  const args = argv.slice(2)
  let prompt: string | undefined
  let apiKey: string | undefined
  let baseUrl: string | undefined
  let provider: string | undefined
  let model: string | undefined
  let autoApprove = false
  let thinking: boolean | undefined
  let reasoningEffort: string | undefined
  let mode: 'code' | 'plan' | undefined
  let temperature: number | undefined
  let maxTokens: number | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-p' || arg === '--prompt') {
      prompt = args[++i]
    } else if (arg === '--api-key') {
      apiKey = args[++i]
    } else if (arg === '--base-url') {
      baseUrl = args[++i]
    } else if (arg === '--provider') {
      provider = args[++i]
    } else if (arg === '--model') {
      model = args[++i]
    } else if (arg === '--auto-approve') {
      autoApprove = true
    } else if (arg === '--thinking') {
      thinking = true
    } else if (arg === '--reasoning-effort') {
      reasoningEffort = args[++i]
    } else if (arg === '--mode') {
      mode = args[++i] as 'code' | 'plan'
    } else if (arg === '--temperature') {
      temperature = parseFloat(args[++i])
    } else if (arg === '--max-tokens') {
      maxTokens = parseInt(args[++i], 10)
    }
  }

  if (!prompt && args.length > 0 && !args[0].startsWith('-')) {
    prompt = args[0]
  }

  const config = loadConfig({ apiKey, baseUrl, provider: provider as 'openai' | 'anthropic' | 'google' | 'ollama' | undefined, model, autoApprove, thinking, reasoningEffort, mode, temperature, maxTokens })

  return { config, prompt }
}