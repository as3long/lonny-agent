import type { ToolCall, ToolResult } from '../tools/types.js'
import { EventChannels, getGlobalEventBus } from './event-bus.js'
import type { SessionOutput } from './session.js'

// ── Colors ─────────────────────────────────────────────────────────────────

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const RE = '\x1b[31m'
const MG = '\x1b[35m'
const GY = '\x1b[90m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'
const TH = '\x1b[48;2;22;22;32m\x1b[38;2;150;150;170m'

export { BLD, CY, GR, GY, MG, RE, RS, TH, YE }

/** Get terminal width (columns), default to 80. */
export function termWidth(): number {
  return process.stdout.columns ?? 80
}

/** Visible width of a string (strip ANSI codes). ASCII=1, CJK/non-ASCII=2. */
export function visibleWidth(s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x1b) {
      while (i < s.length && s[i] !== 'm') i++
      continue
    }
    w += s.charCodeAt(i) > 0x7e ? 2 : 1
  }
  return w
}

/** Visible prefix width for thinking box lines: "  │" = 3 */
export const THINK_PREFIX_WIDTH = 3

/** Build the top border of the thinking box */
export function thinkTopBorder(): string {
  return `\n  ${GY}╭───────${RS}${TH} Think ${GY}────────────────────${RS}\n`
}

/** Build the bottom border of the thinking box */
export function thinkBottomBorder(): string {
  return `  ${GY}╰${'─'.repeat(42)}${RS}\n\n`
}

export function writeOut(text: string, output?: SessionOutput): void {
  if (output) {
    output.write(text)
  } else {
    process.stdout.write(text)
  }
}

export function printUserMessage(prompt: string, output?: SessionOutput): void {
  if (output?.suppressToolOutput) return
  const line = `  ${GY}┃${RS} ${BLD}${CY}You${RS}`
  writeOut(`\n${line}  ${prompt}\n\n`, output)
}

export function printToolInvocation(tc: ToolCall, output?: SessionOutput): void {
  const detail = formatToolInput(tc)
  const isWrite = tc.name === 'write_plan' || tc.name === 'edit'
  const icon = isWrite ? `${YE}◆${RS}` : `${GR}◇${RS}`
  const label = isWrite ? `${YE}${tc.name}${RS}` : `${GR}${tc.name}${RS}`
  writeOut(`\n  ${GY}│${RS}  ${icon} ${label}${detail ? ` ${GY}${detail}${RS}` : ''}\n`, output)
}

export function printToolResult(tc: ToolCall, result: ToolResult, output?: SessionOutput): void {
  if (!result.success) {
    writeOut(`  ${GY}│${RS}  ${RE}✖${RS} ${RE}${result.error}${RS}\n`, output)
    return
  }
  if (tc.name === 'read') {
    const fileCount = (result.output.match(/^=== /gm) || []).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} read ${fileCount} file(s)\n`, output)
    for (const line of result.output.split('\n')) {
      if (line.startsWith('=== ')) {
        const fp = line.slice(4, line.includes(' ===') ? line.indexOf(' ===') + 4 : undefined)
        writeOut(`  ${GY}│${RS}    ${GY}${fp}${RS}\n`, output)
      }
    }
  } else if (tc.name === 'glob') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} glob ${count} match(es)\n`, output)
  } else if (tc.name === 'grep') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} grep ${count} match(es)\n`, output)
  } else if (tc.name === 'bash') {
    const outLines = result.output.split('\n')
    const summary = outLines.length > 1 ? `(${outLines.length} lines)` : ''
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} bash ${summary}\n`, output)
  } else if (tc.name === 'edit') {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} edit\n`, output)
    if (result.output) {
      for (const l of result.output.split('\n')) {
        if (l.trim()) writeOut(`  ${GY}│${RS}  ${l.trim()}\n`, output)
      }
    }
  } else if (tc.name === 'write_plan') {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} ${result.output || tc.name}\n`, output)
  } else if (tc.name === 'search') {
    writeOut(
      `  ${GY}│${RS}  ${GR}✔${RS} search: ${String(tc.input.query || '').slice(0, 80)}\n`,
      output,
    )
  } else {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} ${tc.name}\n`, output)
  }
}

interface SingleEditShape {
  file_path: string
  old_string: string
  new_string: string
}

function isSingleEditShape(v: unknown): v is SingleEditShape {
  return (
    typeof v === 'object' &&
    v !== null &&
    'file_path' in v &&
    'old_string' in v &&
    'new_string' in v
  )
}

export function formatToolInput(tc: ToolCall): string {
  const parts: string[] = []
  if (tc.name === 'read' && Array.isArray(tc.input.paths)) {
    parts.push(tc.input.paths.join(', '))
  } else if (tc.name === 'glob' && typeof tc.input.pattern === 'string') {
    parts.push(tc.input.pattern)
  } else if (tc.name === 'grep') {
    if (typeof tc.input.pattern === 'string') parts.push(`/${tc.input.pattern}/`)
    if (typeof tc.input.include === 'string') parts.push(`in:${tc.input.include}`)
  } else if (tc.name === 'ls') {
    parts.push(typeof tc.input.path === 'string' ? tc.input.path : '.')
  } else if (tc.name === 'bash') {
    const cmd = typeof tc.input.command === 'string' ? tc.input.command : ''
    parts.push(cmd.length > 80 ? `${cmd.slice(0, 80)}\u2026` : cmd)
  } else if (tc.name === 'search') {
    if (typeof tc.input.query === 'string') parts.push(tc.input.query.slice(0, 120))
  } else if (tc.name === 'write_plan') {
    if (typeof tc.input.filename === 'string') parts.push(tc.input.filename)
  } else if (tc.name === 'edit') {
    if (Array.isArray(tc.input.edits) && tc.input.edits.every(isSingleEditShape)) {
      const paths = tc.input.edits.map(e => e.file_path)
      parts.push(paths.join(', '))
    }
  }
  return parts.join(' \u2502 ')
}

export function printTokenStats(
  turnIn: number,
  turnOut: number,
  totalIn: number,
  totalOut: number,
  turnApi: number,
  totalApi: number,
  output?: SessionOutput,
  turnCacheHit?: number,
  turnCacheMiss?: number,
  totalCacheHit?: number,
  totalCacheMiss?: number,
): void {
  const bus = getGlobalEventBus()
  bus.emit(EventChannels.TOKEN_STATS, {
    turnIn,
    turnOut,
    totalIn,
    totalOut,
    turnApi,
    totalApi,
    turnCacheHit,
    turnCacheMiss,
    totalCacheHit,
    totalCacheMiss,
  })
  if (output?.suppressToolOutput) return
  const total = totalIn + totalOut
  let msg = `  ${GY}┃${RS} ${GY}${BLD}▴${RS}${GY}${turnIn}${RS} ${GY}${BLD}▾${RS}${GY}${turnOut}${RS}  ${GY}total${RS} ${total}  ${GY}calls${RS} ${turnApi}(${totalApi})`
  const cacheHit = totalCacheHit ?? 0
  const cacheMiss = totalCacheMiss ?? 0
  const cacheTotal = cacheHit + cacheMiss
  if (cacheTotal > 0) {
    const pct = Math.round((cacheHit / cacheTotal) * 100)
    msg += `  ${GY}cached${RS} ${pct}%`
  }
  writeOut(`\n${msg}\n`, output)
}
