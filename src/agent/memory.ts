import * as fs from 'node:fs'
import * as path from 'node:path'

export interface MemoryEntry {
  id: string
  createdAt: string
  content: string
  tags?: string[]
}

const MEM_DIR = '.lonny/memory'

export function getMemoryDir(cwd: string): string {
  return path.resolve(cwd, MEM_DIR)
}

export function ensureMemoryDir(cwd: string): void {
  const d = getMemoryDir(cwd)
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
}

export function loadMemory(cwd: string): MemoryEntry[] {
  const d = getMemoryDir(cwd)
  try {
    if (!fs.existsSync(d)) return []
    const files = fs.readdirSync(d).filter(f => f.endsWith('.json'))
    const out: MemoryEntry[] = []
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'))
        out.push(data as MemoryEntry)
      } catch (e) {
        // ignore corrupted file
      }
    }
    // sort by createdAt
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return out
  } catch (e) {
    return []
  }
}

export function saveMemory(cwd: string, entry: MemoryEntry): void {
  ensureMemoryDir(cwd)
  const id = entry.id || String(Date.now())
  const file = path.join(getMemoryDir(cwd), `${id}.json`)
  fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8')
}

export function formatMemoryForPrompt(memories: MemoryEntry[]): string {
  if (!memories || memories.length === 0) return ''
  const parts: string[] = []
  for (const m of memories) {
    parts.push(
      `- [${m.createdAt}] ${m.content.slice(0, 400).replace(/\n/g, ' ')}${m.content.length > 400 ? '…' : ''}`,
    )
  }
  return parts.join('\n')
}
