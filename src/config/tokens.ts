import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'

interface TokenStatsData {
  totalInputTokens: number
  totalOutputTokens: number
  updatedAt: string
  projectPath: string
  projectName: string
}

function getTokenDir(): string {
  return path.join(os.homedir(), '.lonny', 'tokens')
}

function getTokenFilePath(cwd: string): string {
  const absPath = path.resolve(cwd)
  const hash = createHash('sha256').update(absPath, 'utf-8').digest('hex').slice(0, 12)
  const dirName = path.basename(absPath)
  const safeName = dirName.replace(/[<>:"/\\|?*]/g, '_')
  return path.join(getTokenDir(), `${safeName}-${hash}.json`)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export interface TokenUsage {
  totalInputTokens: number
  totalOutputTokens: number
  projectPath: string
  projectName: string
  updatedAt: string
}

export function loadTokenUsage(cwd: string): TokenUsage {
  const filePath = getTokenFilePath(cwd)
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TokenStatsData
    return {
      totalInputTokens: data.totalInputTokens,
      totalOutputTokens: data.totalOutputTokens,
      projectPath: data.projectPath,
      projectName: data.projectName,
      updatedAt: data.updatedAt,
    }
  } catch {
    const absPath = path.resolve(cwd)
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      projectPath: absPath,
      projectName: path.basename(absPath),
      updatedAt: '',
    }
  }
}

export function saveTokenUsage(cwd: string, inputTokens: number, outputTokens: number): TokenUsage {
  const dir = getTokenDir()
  ensureDir(dir)

  const filePath = getTokenFilePath(cwd)
  const existing = loadTokenUsage(cwd)

  const data: TokenStatsData = {
    totalInputTokens: existing.totalInputTokens + inputTokens,
    totalOutputTokens: existing.totalOutputTokens + outputTokens,
    updatedAt: new Date().toISOString(),
    projectPath: existing.projectPath,
    projectName: existing.projectName,
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

  return {
    totalInputTokens: data.totalInputTokens,
    totalOutputTokens: data.totalOutputTokens,
    projectPath: data.projectPath,
    projectName: data.projectName,
    updatedAt: data.updatedAt,
  }
}

/**
 * List all per-project token stats in ~/.lonny/tokens/
 */
export function listAllTokenUsage(): (TokenUsage & { file: string })[] {
  const dir = getTokenDir()
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    return files.map(f => {
      const fullPath = path.join(dir, f)
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as TokenStatsData
        return {
          totalInputTokens: data.totalInputTokens,
          totalOutputTokens: data.totalOutputTokens,
          projectPath: data.projectPath,
          projectName: data.projectName,
          updatedAt: data.updatedAt,
          file: f,
        }
      } catch {
        return null
      }
    }).filter((x): x is TokenUsage & { file: string } => x !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}
