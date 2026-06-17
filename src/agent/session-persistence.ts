import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ToolCall, ToolResult } from '../tools/types.js'
import type { LLMMessage } from './llm.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionInfo {
  id: string
  cwd: string
  title: string
  messageCount: number
  mode: 'code' | 'plan' | 'ask' | 'loop'
  model: string
  provider: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  createdAt: string
  updatedAt: string
  fileName: string
}

export interface SessionData {
  id: string
  cwd: string
  title?: string
  messages: LLMMessage[]
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  totalCacheHitTokens?: number
  totalCacheMissTokens?: number
  mode: 'code' | 'plan' | 'ask' | 'loop'
  model: string
  provider: string
  createdAt: string
  updatedAt: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function generateId(): string {
  return randomUUID().slice(0, 8)
}

export function getSessionDir(): string {
  return path.join(os.homedir(), '.lonny', 'sessions')
}

export function getLogDir(): string {
  return path.join(os.homedir(), '.lonny', 'log')
}

export function logToolError(tc: ToolCall, result: ToolResult, sessionId: string): void {
  const logDir = getLogDir()
  ensureDir(logDir)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `tool-error-${sessionId}-${timestamp}.json`
  const logEntry = {
    timestamp: new Date().toISOString(),
    sessionId,
    toolName: tc.name,
    toolInput: tc.input,
    error: result.error || '',
  }
  try {
    fs.writeFileSync(path.join(logDir, fileName), JSON.stringify(logEntry, null, 2), 'utf-8')
  } catch {
    // Silently ignore log write failures
  }
}

/** Base name for session files (safe directory name + hash) */
export function getSessionBaseName(cwd: string): string {
  const absPath = path.resolve(cwd)
  const hash = createHash('sha256').update(absPath, 'utf-8').digest('hex').slice(0, 12)
  const dirName = path.basename(absPath)
  const safeName = dirName.replace(/[<>:"/\\|?*]/g, '_')
  return `${safeName}-${hash}`
}

/**
 * Get the file path for a session.
 * If sessionId is provided, uses multi-session naming: {base}-{id}.json
 * Otherwise returns the legacy single-session path: {base}.json
 */
export function getSessionFilePath(cwd: string, sessionId?: string): string {
  const base = getSessionBaseName(cwd)
  if (sessionId) {
    return path.join(getSessionDir(), `${base}-${sessionId}.json`)
  }
  return path.join(getSessionDir(), `${base}.json`)
}

/** List all session files for a given cwd, sorted by updatedAt (most recent first). */
export function getSessionFilesForCwd(cwd: string): { fileName: string; data: SessionData }[] {
  const dir = getSessionDir()
  const base = getSessionBaseName(cwd)
  try {
    if (!fs.existsSync(dir)) return []
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.startsWith(base))
    const results: { fileName: string; data: SessionData }[] = []
    for (const fileName of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, fileName), 'utf-8')) as Record<
          string,
          unknown
        >
        results.push({ fileName, data: migrateSessionData(raw) })
      } catch {
        // Skip corrupted files
      }
    }
    results.sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt))
    return results
  } catch {
    return []
  }
}

/** Find the legacy single-session file for a cwd (backward compatibility). */
export function findLegacySessionFile(cwd: string): string | null {
  const legacyPath = getSessionFilePath(cwd) // {base}.json (no sessionId)
  if (fs.existsSync(legacyPath)) return legacyPath
  return null
}

// Migrate old-format session files (without id) to new format
export function migrateSessionData(data: Record<string, unknown>): SessionData {
  if (!data.id) {
    data.id = generateId()
  }
  if (!data.createdAt) {
    data.createdAt = (data.updatedAt as string) || new Date().toISOString()
  }
  return data as unknown as SessionData
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
