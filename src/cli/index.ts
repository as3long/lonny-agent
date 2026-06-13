import { type Config, loadConfig } from '../config/index.js'
import { runInit } from './init.js'

export interface CliOptions {
  config: Config
  prompt?: string
  web?: boolean
  port?: number
  init?: boolean
}

export async function parseArgs(argv: string[]): Promise<CliOptions> {
  const args = argv.slice(2)

  // Check for init command
  if (args[0] === 'init') {
    await runInit()
    return { init: true } as CliOptions
  }

  let prompt: string | undefined
  let autoApprove: boolean | undefined
  let mode: 'code' | 'plan' | 'ask' | 'loop' | undefined
  let web = false
  let port: number | undefined

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '-p' || arg === '--prompt') {
      prompt = args[++i]
    } else if (arg === '--auto-approve') {
      autoApprove = true
    } else if (arg === '--mode') {
      mode = args[++i] as 'code' | 'plan' | 'ask' | 'loop'
    } else if (arg === '--web') {
      web = true
    } else if (arg === '--port') {
      port = parseInt(args[++i], 10)
    }
  }

  if (!prompt && args.length > 0 && !args[0].startsWith('-')) {
    prompt = args[0]
  }

  const config = loadConfig({ autoApprove, mode })

  return { config, prompt, web, port }
}
