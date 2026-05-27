#!/usr/bin/env node
import { execSync } from 'node:child_process'
import * as os from 'node:os'
import { runAgent } from './agent/index.js'
import { parseArgs } from './cli/index.js'
import { fmtErr } from './tools/errors.js'
import { startTui } from './tui/index.js'

const RE = '\x1b[31m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'

function tryEnableUtf8(): void {
  if (os.platform() !== 'win32') return
  try {
    execSync('chcp 65001', { stdio: 'pipe' })
  } catch {
    // ignore
  }
  try {
    if (process.stdin.isTTY) process.stdin.setEncoding('utf8')
  } catch {
    // ignore
  }
}

async function main() {
  tryEnableUtf8()
  const { config, prompt } = parseArgs(process.argv)

  if (!config.apiKey) {
    console.error(
      `${RE}Error:${RS} API key is required. Set ${BLD}LONNY_API_KEY${RS} env var, ${BLD}~/.lonny/config.json${RS}, or pass ${BLD}--api-key${RS}.`,
    )
    process.exit(1)
  }

  if (prompt) {
    await runAgent(prompt, config)
  } else {
    await startTui(config)
  }
}

main().catch(err => {
  const msg = fmtErr(err)
  console.error(`\n${RE}Fatal error:${RS} ${msg}`)
  process.exit(1)
})
