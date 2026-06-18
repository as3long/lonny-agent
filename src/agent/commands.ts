import type { Config } from '../config/index.js'
import { resetTokenUsage } from '../config/tokens.js'
import { fmtErr } from '../tools/errors.js'
import { resetGlobalEventBus } from './event-bus.js'
import type { LLMMessage } from './llm.js'
import { ensurePromptsDir, loadPromptTemplates } from './prompt-templates.js'
import { Session } from './session.js'
import { ensureSkillsDir, loadSkills } from './skills.js'

export interface CommandUI {
  write(text: string): void
  replaceContent(text: string): void
  onStateChange(): void
  onNewSession(session: Session): void
}

export interface CommandEnv {
  session: Session
  config: Config
  ui: CommandUI
  isRunning: boolean
}

export function handleNew(env: CommandEnv): Session {
  env.session.stop()
  Session.clearSavedSession(env.config.cwd)
  resetTokenUsage(env.config.cwd)
  resetGlobalEventBus()
  const newSession = new Session(env.config, env.session.output)
  newSession.onPlanWritten = env.session.onPlanWritten
  env.ui.replaceContent('')
  env.ui.onNewSession(newSession)
  env.ui.onStateChange()
  return newSession
}

export async function handleMode(env: CommandEnv, mode: string): Promise<boolean> {
  if (mode !== 'code' && mode !== 'plan' && mode !== 'ask' && mode !== 'loop') {
    env.ui.write(`Usage: /mode code|plan|ask|loop  (current: ${env.session.config.mode})`)
    return true
  }
  await env.session.setMode(mode)
  env.ui.write(`Switched to ${mode} mode`)
  env.ui.onStateChange()
  return true
}

export function handleModel(env: CommandEnv, model: string): boolean {
  if (!model) {
    env.ui.write(`Current model: ${env.session.config.model}`)
    return true
  }
  env.session.config.model = model
  // Trigger system prompt rebuild by re-setting mode
  env.session.setMode(env.session.config.mode)
  env.ui.write(`Model switched to ${model}`)
  env.ui.onStateChange()
  return true
}

export function handlePrompts(env: CommandEnv): boolean {
  const templates = loadPromptTemplates(env.config.cwd)
  if (templates.length === 0) {
    env.ui.write('No prompt templates found. Create .md files in .lonny/prompts/')
  } else {
    let msg = `Prompt Templates (${templates.length}):\n`
    for (const t of templates) {
      msg += `  \u2022 ${t.name}`
      if (t.description) msg += ` \u2014 ${t.description}`
      msg += '\n'
    }
    env.ui.write(msg.trimEnd())
  }
  return true
}

export function handleSkills(env: CommandEnv): boolean {
  const skills = loadSkills(env.config.cwd)
  if (skills.length === 0) {
    env.ui.write('No skills loaded. Create .md files in .lonny/skills/')
  } else {
    let msg = `Active Skills (${skills.length}):\n`
    for (const s of skills) {
      msg += `  \u2022 ${s.name}`
      if (s.description) msg += ` \u2014 ${s.description}`
      msg += '\n'
    }
    env.ui.write(msg.trimEnd())
  }
  return true
}

export function handleSessions(env: CommandEnv): boolean {
  const allSessions = Session.listSessions()
  if (allSessions.length === 0) {
    env.ui.write('No saved sessions found.')
    return true
  }
  let msg = `Saved Sessions (${allSessions.length}):\n`
  msg +=
    '  ID        Title                                       Mode    Messages  Tokens    Updated\n'
  for (const s of allSessions) {
    const id = s.id.padEnd(9)
    const title = (s.title || '(untitled)').slice(0, 42).padEnd(43)
    const mode = s.mode.padEnd(7)
    const msgs = String(s.messageCount).padEnd(9)
    const tokens = String(s.totalInputTokens + s.totalOutputTokens).padEnd(9)
    const date = s.updatedAt.slice(0, 10)
    msg += `  ${id} ${title} ${mode} ${msgs} ${tokens} ${date}\n`
  }
  msg += '\n  Use /session delete <id> to delete a session'
  env.ui.write(msg)
  return true
}

export async function handleSessionCommand(env: CommandEnv, arg: string): Promise<boolean> {
  if (arg === 'delete' || arg.startsWith('delete ')) {
    const id = arg.slice(arg.startsWith('delete ') ? 7 : 6).trim()
    if (id) {
      const deleted = Session.deleteSession(id)
      if (deleted) {
        env.ui.write(`Deleted session ${id}`)
      } else {
        env.ui.write(`Session not found: ${id}`)
      }
    } else {
      env.ui.write('Usage: /session delete <id>')
    }
    return true
  }

  if (arg.startsWith('title ')) {
    const title = arg.slice(6).trim()
    if (title) {
      env.session.sessionTitle = title
      env.session.save()
      env.ui.write(`Session titled: ${title}`)
    } else {
      env.ui.write('Usage: /session title <name>')
    }
    return true
  }

  if (arg === 'export') {
    try {
      const filePath = env.session.exportSession()
      env.ui.write(`Session exported to ${filePath}`)
    } catch (err) {
      env.ui.write(`Export failed: ${fmtErr(err)}`)
    }
    return true
  }

  if (arg === 'switch' || arg.startsWith('switch ')) {
    const id = arg.startsWith('switch ') ? arg.slice(7).trim() : ''
    if (!id) {
      env.ui.write('Usage: /session switch <id>. Use /sessions to list session IDs.')
      return true
    }
    if (env.isRunning) {
      env.ui.write('Cannot switch session while agent is running. Wait or use /stop first.')
      return true
    }
    const switched = await Session.loadById(id, env.config, env.session.output)
    if (switched) {
      switched.onPlanWritten = env.session.onPlanWritten
      const preview = lastUserQuestion(switched.messages)
      let msg = `Switched to session ${switched.sessionTitle || switched.sessionId}`
      if (preview) msg += ` Last question: ${preview}`
      env.ui.replaceContent(msg + '\n')
      env.ui.onNewSession(switched)
      env.ui.onStateChange()
    } else {
      env.ui.write(`Session not found: ${id}`)
    }
    return true
  }

  // Default: show current session info
  const id = env.session.sessionId
  const title = env.session.sessionTitle || '(untitled)'
  const mode = env.session.config.mode
  const model = env.session.config.model
  const provider = env.session.config.provider
  const msgs = env.session.messages.length
  const totalIn = env.session.totalInputTokens
  const totalOut = env.session.totalOutputTokens
  const totalApi = env.session.totalApiCalls
  const created = env.session.sessionCreatedAt.slice(0, 10)
  const info =
    '' +
    `ID:       ${id}\n` +
    `Title:    ${title}\n` +
    `Mode:     ${mode}\n` +
    `Model:    ${model} (${provider})\n` +
    `Messages: ${msgs}\n` +
    `Tokens:   ${totalIn + totalOut} (in: ${totalIn}, out: ${totalOut})\n` +
    `API Calls: ${totalApi}\n` +
    `Created:  ${created}\n`
  env.ui.write(info.trimEnd())
  return true
}

export async function handleFork(env: CommandEnv): Promise<boolean> {
  if (env.isRunning) {
    env.ui.write('Cannot fork while agent is running. Wait or use /stop first.')
    return true
  }
  if (env.session.messages.length <= 1) {
    env.ui.write('No conversation to fork. Start a conversation first.')
    return true
  }
  const forked = env.session.fork()
  forked.onPlanWritten = env.session.onPlanWritten
  const baseTitle = forked.sessionTitle || 'forked session'
  env.ui.write(`Forked new session: ${baseTitle}`)
  env.ui.write(`  ID: ${forked.sessionId}`)
  env.ui.onNewSession(forked)
  env.ui.onStateChange()
  return true
}

export function handleInit(env: CommandEnv): boolean {
  ensureSkillsDir(env.config.cwd)
  ensurePromptsDir(env.config.cwd)
  env.ui.write('Initialized .lonny/skills/ and .lonny/prompts/')
  return true
}

export function handleStop(env: CommandEnv): boolean {
  if (!env.isRunning) {
    env.ui.write('Agent is not running.')
    return true
  }
  env.session.stop()
  env.ui.write('Stopping agent...')
  return true
}

function lastUserQuestion(messages: LLMMessage[]): string | null {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUserMsg || typeof lastUserMsg.content !== 'string') return null
  return lastUserMsg.content.length > 80
    ? `${lastUserMsg.content.slice(0, 80)}\u2026`
    : lastUserMsg.content
}

export async function dispatchCommand(env: CommandEnv, cmd: string, arg: string): Promise<boolean> {
  switch (cmd) {
    case 'new':
      handleNew(env)
      return true
    case 'mode':
      return handleMode(env, arg)
    case 'model':
      return handleModel(env, arg)
    case 'prompts':
      return handlePrompts(env)
    case 'skills':
      return handleSkills(env)
    case 'sessions':
      return handleSessions(env)
    case 'session':
      return handleSessionCommand(env, arg)
    case 'fork':
      return handleFork(env)
    case 'init':
      return handleInit(env)
    case 'stop':
      return handleStop(env)
    default:
      return false
  }
}
