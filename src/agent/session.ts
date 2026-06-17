import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Config } from '../config/index.js'
import { FileReadTracker } from '../diff/apply.js'
import { ToolRegistry } from '../tools/registry.js'
import type { ToolCall } from '../tools/types.js'
import type { LLMMessage, LLMProvider } from './llm.js'
import { buildSystemPrompt } from './prompt-builder.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { GoogleProvider } from './providers/google.js'
import { OllamaProvider } from './providers/ollama.js'
import { OpenAIProvider } from './providers/openai.js'
import { runChat, sanitizeMessages } from './session-chat.js'
import {
  ensureDir,
  findLegacySessionFile,
  generateId,
  getSessionDir,
  getSessionFilePath,
  getSessionFilesForCwd,
  migrateSessionData,
  type SessionData,
  type SessionInfo,
} from './session-persistence.js'

export { formatToolInput } from './session-display.js'

// ── Session output interface ────────────────────────────────────────────────

export interface SessionOutput {
  write: (text: string) => void
  suppressToolOutput?: boolean
  confirmTool?: (toolCalls: ToolCall[]) => Promise<boolean>
}

// ── Session class ────────────────────────────────────────────────────────────

export class Session {
  messages: LLMMessage[]
  provider: LLMProvider
  registry: ToolRegistry
  applier: FileReadTracker
  config: Config
  output?: SessionOutput
  private _onPlanWritten?: (display: string) => void

  set onPlanWritten(cb: ((display: string) => void) | undefined) {
    this._onPlanWritten = cb
    this.registry.updateContext({ onPlanWritten: cb })
    if (this.registry.has('write_plan')) {
      this.registry.reRegisterWritePlan(this.config.cwd, cb)
    }
  }
  get onPlanWritten(): ((display: string) => void) | undefined {
    return this._onPlanWritten
  }
  totalInputTokens: number = 0
  totalOutputTokens: number = 0
  turnInputTokens: number = 0
  turnOutputTokens: number = 0
  turnApiCalls: number = 0
  totalApiCalls: number = 0
  turnCacheHitTokens: number = 0
  turnCacheMissTokens: number = 0
  totalCacheHitTokens: number = 0
  totalCacheMissTokens: number = 0
  stopped: boolean = false
  abortController: AbortController | null = null

  constructor(config: Config, output?: SessionOutput) {
    this.config = config
    this.output = output
    this.applier = new FileReadTracker()
    this.registry = new ToolRegistry({
      cwd: config.cwd,
      autoApprove: config.autoApprove,
      applier: this.applier,
      mode: config.mode,
      onPlanWritten: this.onPlanWritten,
    })

    if (config.provider === 'openai') {
      this.provider = new OpenAIProvider(
        config.apiKey,
        config.baseUrl,
        config.model,
        config.thinking,
        config.reasoningEffort,
        config.enableCache,
        config.strictTools,
      )
    } else if (config.provider === 'google') {
      this.provider = new GoogleProvider(config.apiKey, config.baseUrl, config.model)
    } else if (config.provider === 'ollama') {
      this.provider = new OllamaProvider(config.apiKey, config.baseUrl, config.model)
    } else {
      this.provider = new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
    }

    this.messages = [{ role: 'system', content: '' }]
    this.initSystemPrompt(config)
  }

  private initSystemPrompt(config: Config): void {
    buildSystemPrompt(config, this.registry.getDefinitions()).then(prompt => {
      if (this.messages.length <= 1) {
        this.messages = [{ role: 'system', content: prompt }]
      }
    })
  }

  sessionId: string = generateId()
  sessionTitle: string = ''
  sessionCreatedAt: string = new Date().toISOString()

  save(): void {
    const dir = getSessionDir()
    ensureDir(dir)
    const filePath = getSessionFilePath(this.config.cwd, this.sessionId)
    const now = new Date().toISOString()
    let title = this.sessionTitle
    if (!title) {
      const firstUserMsg = this.messages.find(m => m.role === 'user')
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        title = firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ')
      }
    }
    const data: SessionData = {
      id: this.sessionId,
      title: title || undefined,
      cwd: path.resolve(this.config.cwd),
      messages: this.messages,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalApiCalls: this.totalApiCalls,
      totalCacheHitTokens: this.totalCacheHitTokens || undefined,
      totalCacheMissTokens: this.totalCacheMissTokens || undefined,
      mode: this.config.mode,
      model: this.config.model,
      provider: this.config.provider,
      createdAt: this.sessionCreatedAt,
      updatedAt: now,
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  static async load(config: Config, output?: SessionOutput): Promise<Session | null> {
    const cwdSessions = getSessionFilesForCwd(config.cwd)
    console.log(
      `[session] Found ${cwdSessions.length} session files for cwd "${config.cwd}":`,
      cwdSessions
        .map(
          f =>
            `${f.fileName} (updatedAt=${f.data.updatedAt?.slice(0, 19)}, messages=${f.data.messages?.length || 0})`,
        )
        .join(', '),
    )
    if (cwdSessions.length > 0) {
      cwdSessions.sort((a, b) => {
        const aLen = a.data.messages?.length || 0
        const bLen = b.data.messages?.length || 0
        if (aLen !== bLen) return bLen - aLen
        return b.data.updatedAt.localeCompare(a.data.updatedAt)
      })
      console.log(`[session] Loading session file: ${cwdSessions[0].fileName}`)
      return Session.loadFromData(cwdSessions[0].data, config, output)
    }

    const legacyPath = findLegacySessionFile(config.cwd)
    if (legacyPath) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as Record<string, unknown>
        const data = migrateSessionData(raw)
        const session = await Session.loadFromData(data, config, output)
        session.save()
        try {
          fs.unlinkSync(legacyPath)
        } catch {
          /* ignore */
        }
        return session
      } catch {
        return null
      }
    }

    return null
  }

  static async loadById(
    sessionId: string,
    config: Config,
    output?: SessionOutput,
  ): Promise<Session | null> {
    const allSessions = Session.listSessions()
    const target = allSessions.find(s => s.id === sessionId)
    if (!target) return null
    const legacyPath = findLegacySessionFile(config.cwd)
    if (legacyPath) {
      try {
        const raw = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as Record<string, unknown>
        const data = migrateSessionData(raw)
        if (data.id === sessionId) {
          return Session.loadFromData(data, config, output)
        }
      } catch {
        /* ignore */
      }
    }
    const filePath = getSessionFilePath(target.cwd, sessionId)
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>
      return Session.loadFromData(migrateSessionData(raw), config, output)
    } catch {
      return null
    }
  }

  private static async loadFromData(
    data: SessionData,
    config: Config,
    output?: SessionOutput,
  ): Promise<Session> {
    const session = new Session(config, output)
    session.messages = data.messages
    console.log(`[session] Loading session ${data.id}: ${data.messages.length} messages from disk`)
    session.messages = sanitizeMessages(session.messages)
    console.log(
      `[session] After sanitize: ${session.messages.length} messages (removed ${data.messages.length - session.messages.length})`,
    )
    session.sessionId = data.id
    session.sessionTitle = data.title || ''
    session.sessionCreatedAt = data.createdAt
    config.mode = data.mode
    session.registry.setMode(data.mode)
    if (data.model !== config.model || data.provider !== config.provider) {
      const prompt = await buildSystemPrompt(config, session.registry.getDefinitions())
      session.messages[0] = { role: 'system', content: prompt }
    }
    session.totalInputTokens = data.totalInputTokens
    session.totalOutputTokens = data.totalOutputTokens
    session.totalApiCalls = data.totalApiCalls
    session.totalCacheHitTokens = data.totalCacheHitTokens ?? 0
    session.totalCacheMissTokens = data.totalCacheMissTokens ?? 0
    return session
  }

  static clearSavedSession(cwd: string): void {
    const cwdSessions = getSessionFilesForCwd(cwd)
    for (const { fileName } of cwdSessions) {
      try {
        fs.unlinkSync(path.join(getSessionDir(), fileName))
      } catch {
        /* ignore */
      }
    }
    const legacyPath = findLegacySessionFile(cwd)
    if (legacyPath) {
      try {
        fs.unlinkSync(legacyPath)
      } catch {
        /* ignore */
      }
    }
  }

  static listSessions(maxCount?: number): SessionInfo[] {
    const dir = getSessionDir()
    try {
      if (!fs.existsSync(dir)) return []
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      const sessions: SessionInfo[] = []
      for (const fileName of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf-8')) as Record<
            string,
            unknown
          >
          const data = migrateSessionData(raw)
          const firstUserMsg = data.messages.find(m => m.role === 'user')
          let title = data.title || ''
          if (!title && firstUserMsg && typeof firstUserMsg.content === 'string') {
            title = firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ')
          }
          sessions.push({
            id: data.id,
            cwd: data.cwd,
            title,
            messageCount: data.messages.length,
            mode: data.mode,
            model: data.model,
            provider: data.provider,
            totalInputTokens: data.totalInputTokens,
            totalOutputTokens: data.totalOutputTokens,
            totalApiCalls: data.totalApiCalls,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            fileName,
          })
        } catch {
          // Skip corrupted files
        }
      }
      sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      if (maxCount && maxCount > 0) {
        return sessions.slice(0, maxCount)
      }
      return sessions
    } catch {
      return []
    }
  }

  static deleteSession(id: string): boolean {
    const sessions = Session.listSessions()
    const target = sessions.find(s => s.id === id)
    if (!target) return false
    try {
      fs.unlinkSync(path.join(getSessionDir(), target.fileName))
      return true
    } catch {
      return false
    }
  }

  clearSavedSession(): void {
    Session.clearSavedSession(this.config.cwd)
  }

  fork(): Session {
    const forked = new Session(this.config, this.output)
    forked.messages = [...this.messages]
    forked.onPlanWritten = this.onPlanWritten
    const baseTitle = this.sessionTitle || 'forked session'
    forked.sessionTitle = `${baseTitle} (fork)`
    forked.sessionId = generateId()
    forked.sessionCreatedAt = new Date().toISOString()
    forked.save()
    return forked
  }

  exportSession(filePath?: string): string {
    const dir = filePath || path.join(getSessionDir(), `export-${this.sessionId}.json`)
    const now = new Date().toISOString()
    let title = this.sessionTitle
    if (!title) {
      const firstUserMsg = this.messages.find(m => m.role === 'user')
      if (firstUserMsg && typeof firstUserMsg.content === 'string') {
        title = firstUserMsg.content.slice(0, 80).replace(/\n/g, ' ')
      }
    }
    const exportData = {
      id: this.sessionId,
      title: title || '(untitled)',
      cwd: path.resolve(this.config.cwd),
      mode: this.config.mode,
      model: this.config.model,
      provider: this.config.provider,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalApiCalls: this.totalApiCalls,
      totalCacheHitTokens: this.totalCacheHitTokens,
      totalCacheMissTokens: this.totalCacheMissTokens,
      createdAt: this.sessionCreatedAt,
      exportedAt: now,
      messages: this.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : null,
        tool_calls: m.tool_calls
          ? m.tool_calls.map(tc => ({
              id: tc.id,
              name: tc.name,
              input: tc.input,
            }))
          : undefined,
        reasoning_content: m.reasoning_content,
      })),
    }
    const fullPath = path.resolve(dir)
    ensureDir(path.dirname(fullPath))
    fs.writeFileSync(fullPath, JSON.stringify(exportData, null, 2), 'utf-8')
    return fullPath
  }

  async setMode(mode: 'code' | 'plan' | 'ask' | 'loop'): Promise<void> {
    this.config.mode = mode
    this.registry.setMode(mode)
    const prompt = await buildSystemPrompt(this.config, this.registry.getDefinitions())
    this.messages[0] = { role: 'system', content: prompt }
    this.save()
  }

  stop(): void {
    this.stopped = true
    this.abortController?.abort()
  }

  isStopped(): boolean {
    return this.stopped
  }

  resetStopped(): void {
    this.stopped = false
    this.abortController = new AbortController()
  }

  async chat(userPrompt: string): Promise<void> {
    return runChat(this, userPrompt)
  }
}
