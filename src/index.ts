#!/usr/bin/env node
import * as readline from 'node:readline'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { parseArgs } from './cli/index.js'
import { runAgent } from './agent/index.js'
import { Session } from './agent/session.js'
import { Config } from './config/index.js'

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const MG = '\x1b[35m'
const RE = '\x1b[31m'
const GY = '\x1b[90m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'
const CLR = '\x1b[2J\x1b[H'

function tryEnableUtf8(): void {
  if (os.platform() !== 'win32') return
  try {
    execSync('chcp 65001', { stdio: 'ignore' })
  } catch {
    // ignore
  }
}

const BAR_LEN = 48
const TOP = '+' + '-'.repeat(BAR_LEN) + '+'
const BOT = TOP
const SEP_FOOTER = '-'.repeat(40)

function printHeader(config: Config): void {
  const cwd = config.cwd.replace(os.homedir(), '~')
  const modeLabel = config.mode === 'plan' ? `${MG}plan${RS} ` : ''
  process.stdout.write(
    `${CLR}${GY}${TOP}${RS}\n` +
    `  ${BLD}lonny${RS} ${GY}${config.model}${RS}  ${GY}${config.provider}${RS}  ${modeLabel}${GY}${cwd}${RS}\n` +
    `${GY}${BOT}${RS}\n`
  )
}

function printFooter(): void {
  const now = new Date()
  const time = now.toLocaleTimeString()
  process.stdout.write(`\n${GY}-- ${time} ${SEP_FOOTER}${RS}\n`)
}

async function tuiLoop(config: Config): Promise<void> {
  printHeader(config)
  const session = new Session(config)

  while (true) {
    const input = await new Promise<string>((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '',
      })
      rl.question(`  ${CY}>${RS} ${BLD}${CY}You${RS} `, (answer) => {
        rl.close()
        resolve(answer)
      })
    })

    const trimmed = input.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const arg = parts.slice(1).join(' ')

      if (cmd === 'exit' || cmd === 'quit') {
        process.stdout.write(`  ${GY}*${RS} Goodbye!\n`)
        process.exit(0)
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          printHeader(session.config)
          process.stdout.write(`  ${GR}*${RS} Switched to ${arg} mode\n`)
        } else {
          process.stdout.write(`  ${YE}*${RS} Usage: /mode code|plan  (current: ${session.config.mode})\n`)
        }
        continue
      }

      process.stdout.write(`  ${RE}*${RS} Unknown command: /${cmd}\n`)
      continue
    }

    try {
      await session.chat(trimmed)
      printFooter()
    } catch (err) {
      console.error(`\n  ${RE}x${RS} ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function main() {
  tryEnableUtf8()
  const { config, prompt } = parseArgs(process.argv)

  if (!config.apiKey) {
    console.error(`${RE}Error:${RS} API key is required. Set ${BLD}LONNY_API_KEY${RS} env var, ${BLD}~/.lonny/config.json${RS}, or pass ${BLD}--api-key${RS}.`)
    process.exit(1)
  }

  if (prompt) {
    await runAgent(prompt, config)
  } else {
    await tuiLoop(config)
  }
}

main().catch(err => {
  console.error(`\n${RE}Fatal error:${RS} ${err.message}`)
  process.exit(1)
})
