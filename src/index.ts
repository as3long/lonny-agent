#!/usr/bin/env node
import { execSync } from 'node:child_process'
import * as os from 'node:os'
import { runAgent } from './agent/index.js'
import { Session } from './agent/session.js'
import { parseArgs } from './cli/index.js'
import { fmtErr } from './tools/errors.js'
import { startTui } from './tui/index.js'
import { startWebUi } from './web/index.js'

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
  const { config, prompt, web, port, init, continueSession, sessionId } = await parseArgs(
    process.argv,
  )

  // init command exits after completion
  if (init) {
    process.exit(0)
  }

  if (!config.apiKey) {
    console.error(
      `${RE}Error:${RS} API key is required. Run ${BLD}lonny init${RS} to set up, or use env vars / CLI flags.`,
    )
    process.exit(1)
  }

  let loadedSession: Session | null = null

  // Handle --continue and --session flags
  if (continueSession || sessionId) {
    if (sessionId) {
      loadedSession = await Session.loadById(sessionId, config)
      if (loadedSession) {
        console.log(
          `${BLD}Resuming session:${RS} ${loadedSession.sessionTitle || loadedSession.sessionId}`,
        )
      } else {
        console.error(`${RE}Error:${RS} Session not found: ${sessionId}`)
        process.exit(1)
      }
    } else {
      loadedSession = await Session.load(config)
      if (loadedSession) {
        console.log(
          `${BLD}Continuing last session:${RS} ${loadedSession.sessionTitle || loadedSession.sessionId}`,
        )
      }
    }
  }

  if (web) {
    await startWebUi(config, port || 15090)
  } else if (prompt) {
    await runAgent(prompt, config, loadedSession ?? undefined)
  } else {
    await startTui(config, loadedSession ?? undefined)
  }
}

main().catch(err => {
  const msg = fmtErr(err)
  console.error(`\n${RE}Fatal error:${RS} ${msg}`)
  process.exit(1)
})
