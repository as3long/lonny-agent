import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { calculateCost, formatCost, getPricing } from './pricing.js'

export { calculateCost, formatCost, getPricing }

interface TokenStatsData {
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
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
  totalApiCalls: number
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
      totalApiCalls: data.totalApiCalls,
      projectPath: data.projectPath,
      projectName: data.projectName,
      updatedAt: data.updatedAt,
    }
  } catch {
    const absPath = path.resolve(cwd)
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalApiCalls: 0,
      projectPath: absPath,
      projectName: path.basename(absPath),
      updatedAt: '',
    }
  }
}

export function saveTokenUsage(
  cwd: string,
  inputTokens: number,
  outputTokens: number,
  apiCalls: number,
): TokenUsage {
  const dir = getTokenDir()
  ensureDir(dir)

  const filePath = getTokenFilePath(cwd)
  const existing = loadTokenUsage(cwd)

  const data: TokenStatsData = {
    totalInputTokens: existing.totalInputTokens + inputTokens,
    totalOutputTokens: existing.totalOutputTokens + outputTokens,
    totalApiCalls: existing.totalApiCalls + apiCalls,
    updatedAt: new Date().toISOString(),
    projectPath: existing.projectPath,
    projectName: existing.projectName,
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

  return {
    totalInputTokens: data.totalInputTokens,
    totalOutputTokens: data.totalOutputTokens,
    totalApiCalls: data.totalApiCalls,
    projectPath: data.projectPath,
    projectName: data.projectName,
    updatedAt: data.updatedAt,
  }
}

/** Reset token stats to zero for the given project. */
export function resetTokenUsage(cwd: string): TokenUsage {
  const dir = getTokenDir()
  ensureDir(dir)
  const absPath = path.resolve(cwd)
  const filePath = getTokenFilePath(cwd)
  const data: TokenStatsData = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    updatedAt: new Date().toISOString(),
    projectPath: absPath,
    projectName: path.basename(absPath),
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalApiCalls: 0,
    projectPath: absPath,
    projectName: path.basename(absPath),
    updatedAt: data.updatedAt,
  }
}

/**
 * List all per-project token stats in ~/.lonny/tokens/
 */
export function listAllTokenUsage(): (TokenUsage & { file: string })[] {
  const dir = getTokenDir()
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('history'))
    return files
      .map(f => {
        const fullPath = path.join(dir, f)
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as TokenStatsData
          return {
            totalInputTokens: data.totalInputTokens,
            totalOutputTokens: data.totalOutputTokens,
            totalApiCalls: data.totalApiCalls,
            projectPath: data.projectPath,
            projectName: data.projectName,
            updatedAt: data.updatedAt,
            file: f,
          }
        } catch {
          return null
        }
      })
      .filter((x): x is TokenUsage & { file: string } => x !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

/**
 * Get the CSV history file path for token usage records.
 */
function getHistoryCsvPath(cwd: string): string {
  const absPath = path.resolve(cwd)
  const hash = createHash('sha256').update(absPath, 'utf-8').digest('hex').slice(0, 12)
  const dirName = path.basename(absPath)
  const safeName = dirName.replace(/[<>:"/\\|?*]/g, '_')
  return path.join(getTokenDir(), `${safeName}-${hash}-history.csv`)
}

/**
 * Append a row to the token usage CSV history.
 * Each row records a single turn's tokens + estimated cost.
 */
export function appendTokenHistory(
  cwd: string,
  turnInputTokens: number,
  turnOutputTokens: number,
  turnApiCalls: number,
  model: string,
  provider: string,
): void {
  const csvPath = getHistoryCsvPath(cwd)
  const dir = getTokenDir()
  ensureDir(dir)

  const pricing = getPricing(model, provider)
  const cost = calculateCost(turnInputTokens, turnOutputTokens, pricing)
  const now = new Date().toISOString()

  // Create header if file doesn't exist
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(
      csvPath,
      'timestamp,input_tokens,output_tokens,api_calls,model,provider,cost_usd\n',
      'utf-8',
    )
  }

  // Append row
  const line = `${now},${turnInputTokens},${turnOutputTokens},${turnApiCalls},${model},${provider},${cost.toFixed(6)}\n`
  fs.appendFileSync(csvPath, line, 'utf-8')
}

/**
 * Calculate total estimated cost for a project based on its persisted token stats.
 */
export function getProjectCost(cwd: string, model: string, provider: string): string {
  const usage = loadTokenUsage(cwd)
  const pricing = getPricing(model, provider)
  const cost = calculateCost(usage.totalInputTokens, usage.totalOutputTokens, pricing)
  return formatCost(cost)
}

/**
 * Read token history CSV and return all rows as parsed objects.
 */
export function readTokenHistory(cwd: string): {
  timestamp: string
  inputTokens: number
  outputTokens: number
  apiCalls: number
  model: string
  provider: string
  costUsd: number
}[] {
  const csvPath = getHistoryCsvPath(cwd)
  try {
    const content = fs.readFileSync(csvPath, 'utf-8').trim()
    if (!content) return []
    const lines = content.split('\n')
    const headers = lines[0].split(',')
    const inIdx = headers.indexOf('input_tokens')
    const outIdx = headers.indexOf('output_tokens')
    const apiIdx = headers.indexOf('api_calls')
    const modelIdx = headers.indexOf('model')
    const provIdx = headers.indexOf('provider')
    const tsIdx = headers.indexOf('timestamp')
    const costIdx = headers.indexOf('cost_usd')
    if (inIdx < 0 || outIdx < 0) return []

    return lines.slice(1).map(line => {
      const cols = line.split(',')
      return {
        timestamp: cols[tsIdx] || '',
        inputTokens: Number(cols[inIdx]) || 0,
        outputTokens: Number(cols[outIdx]) || 0,
        apiCalls: Number(cols[apiIdx]) || 0,
        model: cols[modelIdx] || '',
        provider: cols[provIdx] || '',
        costUsd: Number(cols[costIdx]) || 0,
      }
    })
  } catch {
    return []
  }
}
