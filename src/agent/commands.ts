import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Config } from '../config/index.js'
import { loadJsonConfig, saveJsonConfig } from '../config/index.js'
import {
  getProjectCost,
  listAllTokenUsage,
  readTokenHistory,
  resetTokenUsage,
} from '../config/tokens.js'
import { fmtErr } from '../tools/errors.js'
import { compact } from './compaction.js'
import { resetGlobalEventBus } from './event-bus.js'
import type { LLMMessage } from './llm.js'
import { scanPlans } from './plans.js'
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

export async function handleMode(env: CommandEnv, arg: string): Promise<boolean> {
  // Parse mode name from first word, rest is optional description (for loop mode)
  const parts = arg.trim().split(/\s+/)
  const mode = parts[0]

  if (
    mode !== 'code' &&
    mode !== 'plan' &&
    mode !== 'ask' &&
    mode !== 'loop' &&
    mode !== 'review'
  ) {
    env.ui.write(`Usage: /mode code|plan|ask|loop|review  (current: ${env.session.config.mode})`)
    return true
  }

  await env.session.setMode(mode)

  // If there's additional text, attach as a task description (used by loop mode)
  if (parts.length > 1) {
    const description = parts.slice(1).join(' ')
    env.session.messages.push({ role: 'user', content: description })
    env.session.save()
    env.ui.write(`Switched to ${mode} mode with task: ${description}`)
  } else {
    env.ui.write(`Switched to ${mode} mode`)
  }

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

export function handleCompact(env: CommandEnv): boolean {
  if (env.isRunning) {
    env.ui.write('Cannot compact while agent is running. Wait or use /stop first.')
    return true
  }
  const result = compact(env.session.messages, env.session.config.contextWindow)
  if (result.compressed) {
    env.session.messages = result.messages
    env.session.save()
    env.ui.write(`Compacted context: ${result.originalCount} → ${result.newCount} messages`)
    env.ui.onStateChange()
  } else {
    const total = result.messages.length
    env.ui.write(`Context is within limits (${total} messages), no compaction needed.`)
  }
  return true
}

export function handleTokens(env: CommandEnv, arg: string): boolean {
  const config = env.session.config

  if (arg === 'reset') {
    resetTokenUsage(config.cwd)
    env.ui.write('Token stats reset to zero for this project.')
    return true
  }

  // Show current session's token stats
  const totalIn = env.session.totalInputTokens
  const totalOut = env.session.totalOutputTokens
  const totalApi = env.session.totalApiCalls
  const cost = getProjectCost(config.cwd, config.model, config.provider)

  let msg = `── Token Usage ──────────────────────────────\n`
  msg += `Current session:\n`
  msg += `  Input:    ${totalIn.toLocaleString()} tokens\n`
  msg += `  Output:   ${totalOut.toLocaleString()} tokens\n`
  msg += `  Total:    ${(totalIn + totalOut).toLocaleString()} tokens\n`
  msg += `  API Calls: ${totalApi}\n`
  msg += `  Est. cost: ${cost}\n`
  msg += `  Model:    ${config.model} (${config.provider})\n\n`

  // Per-project persistent totals from ~/.lonny/tokens/
  const allProjects = listAllTokenUsage()
  if (allProjects.length > 0) {
    msg += `All projects (persistent totals):\n`
    for (const p of allProjects) {
      const pCost = getProjectCost(p.projectPath, config.model, config.provider)
      const tokenTotal = p.totalInputTokens + p.totalOutputTokens
      msg += `  ${p.projectName}: ${tokenTotal.toLocaleString()} tokens, ${p.totalApiCalls} calls, ${pCost}\n`
    }
  }

  // Show recent history from CSV
  const history = readTokenHistory(config.cwd)
  if (history.length > 0) {
    const recent = history.slice(-10)
    msg += `\nRecent turns (last ${recent.length}):\n`
    for (const row of recent) {
      const date = row.timestamp.slice(0, 19).replace('T', ' ')
      msg += `  ${date}  in:${row.inputTokens}  out:${row.outputTokens}  calls:${row.apiCalls}  $${row.costUsd.toFixed(4)}\n`
    }
  }

  msg += `──────────────────────────────────────────`
  env.ui.write(msg)
  return true
}

export function handleConfig(env: CommandEnv, arg: string): boolean {
  const config = loadJsonConfig()

  if (!arg) {
    // Show current config
    const c = env.session.config
    let msg = `── Current Config ────────────────────────────\n`
    msg += `  Provider:  ${c.provider}\n`
    msg += `  Model:     ${c.model}\n`
    msg += `  API Key:   ${c.apiKey ? `${c.apiKey.slice(0, 8)}...` : '(not set)'}\n`
    msg += `  Base URL:  ${c.baseUrl || '(not set)'}\n`
    msg += `  Mode:      ${c.mode}\n`
    msg += `  AutoApprove: ${c.autoApprove}\n`
    msg += `  Thinking:  ${c.thinking ?? '(not set)'}\n`
    msg += `  Cache:     ${c.enableCache ?? '(not set)'}\n`
    msg += `  Temp:      ${c.temperature ?? '(default)'}\n`
    msg += `  MaxTokens: ${c.maxTokens ?? '(default)'}\n`
    msg += `  StrictTools: ${c.strictTools ?? '(not set)'}\n`
    msg += `  Window:    ${c.contextWindow.toLocaleString()} tokens\n\n`
    msg += `Usage: /config <key>=<value>\n`
    msg += `Keys: provider, model, apiKey, baseUrl, autoApprove, thinking, enableCache,\n`
    msg += `      strictTools, temperature, maxTokens, tavilyApiKey, reasoningEffort`
    env.ui.write(msg)
    return true
  }

  // Parse key=value pair
  const eqIdx = arg.indexOf('=')
  let key: string, value: string
  if (eqIdx > 0) {
    key = arg.slice(0, eqIdx).trim()
    value = arg.slice(eqIdx + 1).trim()
  } else {
    // /config key value — space-separated, first word is key
    const parts = arg.split(/\s+/)
    key = parts[0]
    value = parts.slice(1).join(' ')
  }

  if (!key || !value) {
    env.ui.write('Usage: /config <key>=<value>   e.g. /config model=deepseek-v4-flash')
    return true
  }

  // Validate and coerce types
  const validKeys = [
    'provider',
    'model',
    'apiKey',
    'baseUrl',
    'autoApprove',
    'thinking',
    'enableCache',
    'strictTools',
    'temperature',
    'maxTokens',
    'tavilyApiKey',
    'reasoningEffort',
    'contextWindow',
  ]
  if (!validKeys.includes(key)) {
    env.ui.write(`Unknown key: "${key}". Valid keys: ${validKeys.join(', ')}`)
    return true
  }

  const updated = { ...config }

  // Boolean keys
  if (['autoApprove', 'thinking', 'enableCache', 'strictTools'].includes(key)) {
    if (value === 'true' || value === '1' || value === 'yes') {
      ;(updated as Record<string, unknown>)[key] = true
    } else if (value === 'false' || value === '0' || value === 'no') {
      ;(updated as Record<string, unknown>)[key] = false
    } else {
      env.ui.write(`Invalid boolean value: "${value}". Use true/false.`)
      return true
    }
  } else if (key === 'temperature') {
    const num = Number.parseFloat(value)
    if (Number.isNaN(num) || num < 0 || num > 2) {
      env.ui.write('Temperature must be a number between 0 and 2.')
      return true
    }
    ;(updated as Record<string, unknown>)[key] = num
  } else if (key === 'maxTokens' || key === 'contextWindow') {
    const num = Number.parseInt(value, 10)
    if (Number.isNaN(num) || num < 1) {
      env.ui.write(`${key} must be a positive integer.`)
      return true
    }
    ;(updated as Record<string, unknown>)[key] = num
  } else {
    // String keys
    ;(updated as Record<string, unknown>)[key] = value
  }

  saveJsonConfig(updated)

  // Apply critical config changes to the current session immediately
  const session = env.session
  const sessionConfig = session.config
  if (key === 'model') sessionConfig.model = value
  if (key === 'provider')
    sessionConfig.provider = value as 'openai' | 'anthropic' | 'google' | 'ollama'
  if (key === 'baseUrl') sessionConfig.baseUrl = value
  if (key === 'apiKey') sessionConfig.apiKey = value
  if (key === 'autoApprove')
    sessionConfig.autoApprove = value === 'true' || value === '1' || value === 'yes'
  if (key === 'thinking')
    sessionConfig.thinking = value === 'true' || value === '1' || value === 'yes'
  if (key === 'enableCache')
    sessionConfig.enableCache = value === 'true' || value === '1' || value === 'yes'
  if (key === 'strictTools')
    sessionConfig.strictTools = value === 'true' || value === '1' || value === 'yes'
  if (key === 'temperature') sessionConfig.temperature = Number.parseFloat(value)
  if (key === 'maxTokens') sessionConfig.maxTokens = Number.parseInt(value, 10)
  if (key === 'contextWindow') sessionConfig.contextWindow = Number.parseInt(value, 10)
  if (key === 'tavilyApiKey') sessionConfig.tavilyApiKey = value
  if (key === 'reasoningEffort') sessionConfig.reasoningEffort = value

  // Rebuild system prompt for model/provider changes
  if (
    [
      'model',
      'provider',
      'baseUrl',
      'apiKey',
      'temperature',
      'maxTokens',
      'thinking',
      'enableCache',
      'strictTools',
      'contextWindow',
    ].includes(key)
  ) {
    session.setMode(sessionConfig.mode as 'code' | 'plan' | 'ask' | 'loop' | 'review')
    env.ui.write(`Updated ${key}=${value} and rebuilt system prompt.`)
  } else {
    env.ui.write(`Updated ${key}=${value} in config. Changes take effect on next session.`)
  }

  env.ui.onStateChange()
  return true
}

export function handlePlan(env: CommandEnv, arg: string): boolean {
  const config = env.session.config
  const plans = scanPlans(config.cwd)

  if (!arg) {
    // List all plans
    if (plans.length === 0) {
      env.ui.write('No plan files found in .lonny/. Create one with /mode plan first.')
      return true
    }
    let msg = `── Plans ────────────────────────────────────\n`
    for (const p of plans) {
      const status = p.hasPending ? `${p.pendingItems} pending` : 'complete'
      msg += `  ${p.name} [${status}]\n`
      if (p.description) msg += `    ${p.description}\n`
      msg += `    ${p.doneItems}/${p.totalItems} items done`
      if (p.mtime) {
        msg += `  (${new Date(p.mtime).toLocaleDateString()})`
      }
      msg += '\n'
    }
    env.ui.write(msg.trimEnd())
    return true
  }

  // /plan load — refresh system prompt to pick up plan changes
  if (arg === 'load' || arg === 'reload') {
    env.ui.write('Refreshing system prompt to load active plans...')
    env.session.setMode(config.mode as 'code' | 'plan' | 'ask' | 'loop' | 'review')
    env.ui.onStateChange()
    const active = scanPlans(config.cwd).filter(p => p.hasPending)
    if (active.length > 0) {
      env.ui.write(`Loaded ${active.length} plan(s): ${active.map(p => p.name).join(', ')}`)
    } else {
      env.ui.write('No active plans with pending todos found.')
    }
    return true
  }

  // /plan <name> — show detail for a specific plan
  const match = plans.find(p => p.name === arg)
  if (!match) {
    env.ui.write(`Plan not found: "${arg}". Use /plan to list available plans.`)
    return true
  }
  const content = fs.readFileSync(match.fullPath, 'utf-8')
  env.ui.write(`── ${match.name} ────────────────────────────────\n${content.trim()}`)
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
    case 'compact':
      return handleCompact(env)
    case 'config':
      return handleConfig(env, arg)
    case 'tokens':
      return handleTokens(env, arg)
    case 'plan':
      return handlePlan(env, arg)
    case 'plans':
      return handlePlan(env, arg)
    default:
      return false
  }
}
