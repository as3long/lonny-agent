import { resetGlobalEventBus } from '../agent/event-bus.js'
import { Session } from '../agent/session.js'
import { type Config, loadConfig } from '../config/index.js'
import { resetTokenUsage } from '../config/tokens.js'
import { runInit } from './init.js'

export interface CliOptions {
  config: Config
  prompt?: string
  web?: boolean
  port?: number
  init?: boolean
  continueSession?: boolean
  sessionId?: string
  listSessions?: boolean
  deleteSession?: string
}

export async function parseArgs(argv: string[]): Promise<CliOptions> {
  const args = argv.slice(2)

  // Check for init command
  if (args[0] === 'init') {
    await runInit()
    return { init: true } as CliOptions
  }

  // Check for new command — clear all saved sessions, then continue fresh
  if (args[0] === 'new') {
    const config = loadConfig()
    Session.clearSavedSession(config.cwd)
    resetTokenUsage(config.cwd)
    resetGlobalEventBus()
    args.splice(0, 1) // Remove 'new', remaining args become normal arguments
  }

  // ── Session subcommands ──
  if (args[0] === 'session') {
    const sub = args[1]
    if (sub === 'list') {
      const sessions = Session.listSessions()
      if (sessions.length === 0) {
        console.log('No saved sessions found.')
      } else {
        console.log(`\n  Saved Sessions (${sessions.length}):`)
        console.log('  ' + '-'.repeat(80))
        console.log(
          '  ID        Title                                       Mode    Messages  Tokens    Updated',
        )
        console.log('  ' + '-'.repeat(80))
        for (const s of sessions) {
          const id = s.id.padEnd(9)
          const title = (s.title || '(untitled)').slice(0, 42).padEnd(43)
          const mode = s.mode.padEnd(7)
          const msgs = String(s.messageCount).padEnd(9)
          const tokens = String(s.totalInputTokens + s.totalOutputTokens).padEnd(9)
          const date = s.updatedAt.slice(0, 10)
          console.log(`  ${id} ${title} ${mode} ${msgs} ${tokens} ${date}`)
        }
        console.log()
      }
      process.exit(0)
    }
    if (sub === 'delete') {
      const id = args[2]
      if (!id) {
        console.error('Usage: lonny session delete <id>')
        process.exit(1)
      }
      const deleted = Session.deleteSession(id)
      if (deleted) {
        console.log(`Deleted session: ${id}`)
      } else {
        console.error(`Session not found: ${id}`)
        process.exit(1)
      }
      process.exit(0)
    }
    // If just "session" with no subcommand, show usage
    console.log('Usage: lonny session list|delete <id>')
    process.exit(0)
  }

  let prompt: string | undefined
  let autoApprove: boolean | undefined
  let mode: 'code' | 'plan' | 'ask' | 'loop' | undefined
  let web = false
  let port: number | undefined
  let continueSession = false
  let sessionId: string | undefined

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
    } else if (arg === '--continue' || arg === '-c') {
      continueSession = true
    } else if (arg === '--session' || arg === '-s') {
      sessionId = args[++i]
    }
  }

  if (!prompt && args.length > 0 && !args[0].startsWith('-') && args[0] !== 'session') {
    prompt = args[0]
  }

  const config = loadConfig({ autoApprove, mode })

  return { config, prompt, web, port, continueSession, sessionId }
}
