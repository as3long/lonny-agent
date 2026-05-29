import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Component, SelectItem, SelectListTheme } from '../pi-tui/index.js'
import { SelectList } from '../pi-tui/index.js'
import { PLAN_DIR } from '../tools/write_plan.js'
import { visibleLen } from './utils.js'

// ── ANSI Color Helpers ───────────────────────────────────────────────────────

// Re-applies background after every full reset (\x1b[0m) so that foreground
// color resets don't "punch through" the background.
function safeBg(text: string, bg: string): string {
  return `\x1b[${bg}m${text.replace(/\x1b\[0m/g, `\x1b[0m\x1b[${bg}m`)}\x1b[0m`
}

export const colors = {
  bgDark: (text: string) => safeBg(text, '48;2;30;30;30'),
  bgDim: (text: string) => safeBg(text, '48;2;25;25;25'),
  headerBg: (text: string) => safeBg(text, '48;2;170;170;170'),
  separator: (text: string) => `\x1b[38;2;60;60;60m${text}\x1b[0m`,
  statusBg: (text: string) => safeBg(text, '48;2;25;25;35'),
  running: (text: string) => `\x1b[38;2;0;255;100m${text}\x1b[0m`,
  idle: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  doneTodo: (text: string) => `\x1b[38;2;100;200;100m${text}\x1b[0m`,
  todo: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  accent: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[38;2;90;90;90m${text}\x1b[0m`,
  userLabel: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
  assistantLabel: (text: string) => `\x1b[38;2;0;255;150m${text}\x1b[0m`,
  error: (text: string) => `\x1b[38;2;255;80;80m${text}\x1b[0m`,
  success: (text: string) => `\x1b[38;2;0;200;100m${text}\x1b[0m`,
  inputPrompt: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  warn: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
}

// ── App Version (read from package.json) ─────────────────────────────────

const APP_VERSION: string = (() => {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    return JSON.parse(raw).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

// ── Pixel font for "lonnycode" logo (5 rows — 5 cols per char) ──────────

const PIXEL_FONT: Record<string, string[]> = {
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
  D: ['███  ', '█  █ ', '█   █', '█  █ ', '███  '],
  E: ['█████', '█    ', '███  ', '█    ', '█████'],
}

const LONNY_CHARS = ['L', 'O', 'N', 'N', 'Y']
const CODE_CHARS = ['C', 'O', 'D', 'E']

const PIXEL_LOGO_WIDTH = 54 // 5 cols — 9 chars + 8 gaps + 2 gap between words

function renderPixelLogo(): string[] {
  const midGray = '\x1b[38;2;160;160;160m'
  const brightWhite = '\x1b[38;2;255;255;255m'
  const reset = '\x1b[0m'
  const lines: string[] = []
  for (let row = 0; row < 5; row++) {
    const lonnyPart = LONNY_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    const codePart = CODE_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    lines.push(`${midGray + lonnyPart}  ${brightWhite}${codePart}${reset}`)
  }
  return lines
}

// ── Landing input colors ────────────────────────────────────────────────

export const landingColors = {
  inputBg: '\x1b[48;2;35;35;35m',
  inputBorder: '\x1b[38;2;60;60;60m',
  cyanBar: '\x1b[38;2;0;200;255m',
  placeholderDim: '\x1b[38;2;130;130;130m',
  placeholderQuote: '\x1b[38;2;160;160;160m',
  inputText: '\x1b[38;2;220;220;220m',
  statusBg: '\x1b[48;2;18;18;18m',
  statusText: '\x1b[38;2;110;110;110m',
  statusAccent: '\x1b[38;2;0;170;255m',
  reset: '\x1b[0m',
}

// ── Helpers ──────────────────────────────────────────────────────────────

export interface PlanEntry {
  name: string
  description: string
  fullPath: string
  mtime: number
}

export function listPlans(cwd: string): PlanEntry[] {
  const planDir = path.resolve(cwd, PLAN_DIR)
  try {
    const files = fs.readdirSync(planDir)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(planDir, f)
        let mtime = 0
        try {
          mtime = fs.statSync(fullPath).mtimeMs
        } catch {
          /* ignore */
        }
        return {
          name: f.replace(/\.md$/, ''),
          description: f,
          fullPath,
          mtime,
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

export function loadTodos(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const todos: string[] = []
    let inTodo = false
    for (const line of lines) {
      if (line.startsWith('## Todo List')) {
        inTodo = true
        continue
      }
      if (inTodo && line.startsWith('## ')) break
      if (inTodo) {
        const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
        if (m) {
          const done = m[1] === 'x'
          const check = done ? '\u2705' : '\u2B1C'
          todos.push(`${check} ${done ? colors.doneTodo(m[2]) : colors.todo(m[2])}`)
        }
      }
    }
    return todos.length > 0 ? todos.join('\n') : '(no todo items)'
  } catch {
    return '(no plan selected)'
  }
}

export function plansToItems(plans: PlanEntry[]): SelectItem[] {
  return plans.map(p => ({
    value: p.name,
    label: p.name,
    description: p.mtime
      ? `${new Date(p.mtime).toLocaleDateString()} ${new Date(p.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '',
  }))
}

// ── Rich Footer helpers ────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── OpenCode-style Header ────────────────────────────────────────────────

export class HeaderBar implements Component {
  private mode: string
  private model: string
  private provider: string
  private agentStatus: 'running' | 'idle'
  private planCount: number
  private planName: string
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private projectName: string = ''

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
    this.mode = 'code'
    this.agentStatus = 'idle'
    this.planCount = 0
    this.planName = ''
  }

  setMode(m: string): void {
    this.mode = m
  }
  setAgentStatus(s: 'running' | 'idle'): void {
    this.agentStatus = s
  }
  setPlanCount(n: number): void {
    this.planCount = n
  }
  setPlanName(n: string): void {
    this.planName = n
  }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setProjectName(name: string): void {
    this.projectName = name
  }
  invalidate(): void {}
  handleInput?(_data: string): void {}

  render(width: number): string[] {
    const appName = colors.accent('\u2588 lonny')
    const statusDot =
      this.agentStatus === 'running' ? colors.running('\u25CF') : colors.dim('\u25CB')
    const statusLabel =
      this.agentStatus === 'running' ? colors.running('running') : colors.dim('idle')
    const modeLabel = this.mode === 'ask' ? colors.success(this.mode) : colors.warn(this.mode)
    const modelInfo = colors.dim(`${this.provider}/${this.model}`)

    let rightPart = `${statusDot} ${statusLabel}  ${modeLabel}  ${modelInfo}`

    // Show token usage if there are any
    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${this.totalInputTokens} \u25BE${this.totalOutputTokens}  ${totalTokens}`
      const callsStr = `${this.totalApiCalls} calls`
      const projectTag = this.projectName ? `${this.projectName} ` : ''
      rightPart += `  ${colors.dim('|')}  ${colors.dim(`${projectTag}${tokenStr}  ${callsStr}`)}`
    }

    if (this.planCount > 0) {
      rightPart += `  ${colors.dim('|')}  ${colors.accent(`${this.planCount} plan${this.planCount > 1 ? 's' : ''}`)}`
      if (this.planName) rightPart += ` ${colors.dim(this.planName)}`
    }

    const line = ` ${appName}  ${colors.dim('·')}  ${rightPart}`
    return [colors.headerBg(line), colors.dim('\u2500'.repeat(width))]
  }
}

// ── Rich Footer (cwd | mode | tokens | model | version + command hints) ────

export class RichFooter implements Component {
  private cwd: string
  private mode: string = 'code'
  private model: string = ''
  private provider: string = ''
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private balance: string = ''
  private webBalance: string = ''
  private visible = true
  private phase: 'landing' | 'chat' = 'landing'
  private agentStatus: 'running' | 'idle' = 'idle'

  constructor(cwd: string, model: string, provider: string) {
    this.cwd = cwd
    this.model = model
    this.provider = provider
  }

  setMode(m: string): void {
    this.mode = m
  }
  setModel(model: string, provider: string): void {
    this.model = model
    this.provider = provider
  }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setVisible(v: boolean): void {
    this.visible = v
  }
  setPhase(p: 'landing' | 'chat'): void {
    this.phase = p
  }
  setBalance(b: string): void {
    this.balance = b
  }
  setWebBalance(wb: string): void {
    this.webBalance = wb
  }
  setAgentStatus(s: 'running' | 'idle'): void {
    this.agentStatus = s
  }

  invalidate(): void {}
  handleInput?(_data: string): void {}

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    if (!this.visible || width < 40) return []

    const { statusBg, statusText, statusAccent, reset } = landingColors

    // Left: working directory
    const dir = this.cwd.length > 30 ? `...${this.cwd.slice(-27)}` : this.cwd
    const leftPart = `${statusAccent}\u25A0${reset}${statusBg}${statusText} ${dir}${reset}`

    if (this.phase === 'landing') {
      // Minimal: cwd | ready | version
      const centerPart = `${statusBg + statusText}  ready  ${reset}`
      const rightPart = `${statusBg + statusText}v${APP_VERSION} ${reset}`
      const line = leftPart + centerPart + rightPart
      const visLen = this.visibleLen(line)
      const padded = visLen < width ? line + statusBg + ' '.repeat(width - visLen) + reset : line
      return [padded]
    }

    // ── Chat phase: build segments ────────────────────────────────────────
    const segments: string[] = []

    // Status dot
    const statusDot =
      this.agentStatus === 'running'
        ? `\x1b[38;2;0;255;100m\u25CF\x1b[0m`
        : `\x1b[38;2;150;150;150m\u25CB\x1b[0m`
    const statusLabel =
      this.agentStatus === 'running'
        ? `\x1b[38;2;0;255;100mrunning\x1b[0m`
        : `\x1b[38;2;150;150;150midle\x1b[0m`
    segments.push(`${statusDot} ${statusLabel}`)

    // Mode tag
    const modeTag =
      this.mode === 'plan'
        ? `\x1b[38;2;255;200;50m${this.mode}\x1b[0m`
        : this.mode === 'ask'
          ? `\x1b[38;2;0;200;100m${this.mode}\x1b[0m`
          : `\x1b[38;2;0;200;255m${this.mode}\x1b[0m`
    segments.push(modeTag)

    // Model/provider
    if (this.model) {
      segments.push(`\x1b[38;2;110;110;110m${this.provider}/${this.model}\x1b[0m`)
    }

    // Token usage
    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${formatTokens(this.totalInputTokens)} \u25BE${formatTokens(this.totalOutputTokens)}  ${formatTokens(totalTokens)}`
      segments.push(`\x1b[38;2;110;110;110m${tokenStr}\x1b[0m`)
      segments.push(`\x1b[38;2;110;110;110m${this.totalApiCalls}c\x1b[0m`)
    }

    // Balance (DeepSeek official API only)
    if (this.webBalance) {
      // Show the web-style breakdown if available
      segments.push(`\x1b[38;2;255;200;50m\u4F59\u989D\x1b[0m\uFF1A${this.webBalance}`)
    } else if (this.balance) {
      segments.push(`\x1b[38;2;255;200;50m\u4F59\u989D\x1b[0m\uFF1A${this.balance}`)
    }

    // Build center part from segments
    const separator = `${statusBg} \x1b[38;2;60;60;60m\u2502\x1b[0m ${reset}`
    const centerContent = `${statusBg + statusText}  ${segments.join(separator)}  ${reset}`

    // Right: version
    const rightPart = `${statusBg + statusText}v${APP_VERSION} ${reset}`

    const line = leftPart + centerContent + rightPart

    // If there's extra space, append command hints
    const lineLen = line.length - 2 * statusBg.length - reset.length // approximate
    let result = line
    if (lineLen < width - 40) {
      const hints = [
        '\x1b[38;2;110;110;110m/mode\x1b[0m',
        '\x1b[38;2;110;110;110m/plans\x1b[0m',
        '\x1b[38;2;110;110;110m/help\x1b[0m',
        '\x1b[38;2;110;110;110m?\x1b[0m',
      ].join(' \x1b[38;2;60;60;60m\u00b7\x1b[0m ')
      const hintStr = `${statusBg + statusText}  ${hints}  ${reset}`
      // Only append if it fits
      const fullLine = line + hintStr
      // Calculate approximate visible length (strip ANSI)
      const approxLen = fullLine.replace(/\x1b\[[0-9;]*m/g, '').length
      if (approxLen <= width) {
        result = fullLine
      }
    }

    const visLen = this.visibleLen(result)
    const padded = visLen < width ? result + statusBg + ' '.repeat(width - visLen) + reset : result

    return [padded]
  }
}

// ── LandingScreen (pixel logo + welcome) ──────────────────────────────

export class LandingScreen implements Component {
  onSubmit?: (value: string) => void
  private model: string
  private provider: string

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
  }

  invalidate(): void {}

  handleInput(data: string): void {
    // Any key transitions to chat
    if (data && this.onSubmit) {
      this.onSubmit(data)
    }
  }

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    const lines: string[] = []
    const center = (text: string, totalWidth: number): string => {
      const textWidth = this.visibleLen(text)
      const pad = Math.max(0, Math.floor((totalWidth - textWidth) / 2))
      return ' '.repeat(pad) + text
    }

    // ── Pixel logo ─────────────────────────────────────────────────────
    const logoLines = renderPixelLogo()
    const logoPad = Math.max(0, Math.floor((width - PIXEL_LOGO_WIDTH) / 2))
    const padStr = ' '.repeat(logoPad)

    for (const line of logoLines) {
      lines.push(padStr + line)
    }

    // ── Decorative divider ────────────────────────────────────────────
    const divider = colors.dim('\u2500'.repeat(Math.min(36, width - 4)))
    lines.push(center(divider, width))

    // ── Prompt text ───────────────────────────────────────────────────
    lines.push('')
    const prompt =
      colors.dim('Type a message and press ') + colors.accent('Enter') + colors.dim(' to start')
    lines.push(center(prompt, width))
    lines.push('')

    // ── Quick command hints ───────────────────────────────────────────
    const cmds = [
      colors.inputPrompt('/mode'),
      colors.inputPrompt('/model'),
      colors.inputPrompt('/plans'),
      colors.inputPrompt('/help'),
    ].join(colors.dim('  \u00B7  '))
    lines.push(center(colors.dim('Commands: ') + cmds, width))

    // ── Model & version info ──────────────────────────────────────────
    const modelInfo = colors.dim(`${this.provider}/${this.model}`)
    const versionInfo = colors.dim(`v${APP_VERSION}`)
    lines.push(center(modelInfo + colors.separator('  \u2502  ') + versionInfo, width))

    return lines
  }
}

// ── PlansList wrapper (SelectList has no setItems) ───────────────────────

export class PlansList implements Component {
  private selectList: SelectList
  private allItems: SelectItem[]
  private maxVisible: number
  private theme: SelectListTheme
  onSelectionChange?: (item: SelectItem) => void

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.allItems = items
    this.selectList = new SelectList(items, maxVisible, theme)
    this.maxVisible = maxVisible
    this.theme = theme
    this.selectList.onSelectionChange = item => {
      if (this.onSelectionChange) this.onSelectionChange(item)
    }
  }

  setFilter(filter: string): void {
    this.selectList.setFilter(filter)
  }

  clearFilter(): void {
    this.selectList.setFilter('')
  }

  refresh(items: SelectItem[]): void {
    this.allItems = items
    const cb = this.onSelectionChange
    this.selectList = new SelectList(items, this.maxVisible, this.theme)
    this.selectList.onSelectionChange = cb
  }

  getSelectedItem(): SelectItem | null {
    return this.selectList.getSelectedItem()
  }

  setSelectedIndex(index: number): void {
    this.selectList.setSelectedIndex(index)
  }

  invalidate(): void {
    this.selectList.invalidate()
  }

  render(width: number): string[] {
    return this.selectList.render(width)
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data)
  }
}

// ── Persistent Todo Side Panel ───────────────────────────────────────

export class TodoPanel implements Component {
  private cwd: string
  private todos: { text: string; done: boolean }[] = []
  private planName: string = ''
  private dirty: boolean = true

  constructor(cwd: string) {
    this.cwd = cwd
  }

  refresh(): void {
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  private load(): void {
    this.dirty = false
    const plans = listPlans(this.cwd)
    if (plans.length === 0) {
      this.todos = []
      this.planName = ''
      return
    }
    const plan = plans[0]
    this.planName = plan.name
    this.todos = []
    try {
      const content = fs.readFileSync(plan.fullPath, 'utf-8')
      const lines = content.split('\n')
      let inTodo = false
      for (const line of lines) {
        if (line.startsWith('## Todo List')) {
          inTodo = true
          continue
        }
        if (inTodo && line.startsWith('## ')) break
        if (inTodo) {
          const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
          if (m) {
            this.todos.push({ text: m[2], done: m[1] === 'x' })
          }
        }
      }
    } catch {
      // ignore file read errors
    }
  }

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    if (this.dirty) this.load()

    const lines: string[] = []

    // ── Header ──
    const headerText = ` ${colors.accent('\u25B6')} TODO`
    const headerPadding = Math.max(0, width - this.visibleLen(headerText))
    lines.push(colors.bgDark(headerText + ' '.repeat(headerPadding)))

    // ── Divider ──
    lines.push(colors.separator('\u2500'.repeat(width)))

    if (!this.planName) {
      lines.push(colors.dim('  (no plan)'))
      return lines
    }

    if (this.todos.length === 0) {
      lines.push(colors.dim('  (no todos)'))
      return lines
    }

    // ── Todo items ──
    const contentWidth = width - 3 // leave room for icon + space
    for (const todo of this.todos) {
      const icon = todo.done ? '\u2705' : '\u2B1C'
      const textStyle = todo.done ? colors.doneTodo : colors.todo
      const text = todo.text
      // Truncate text if too long (account for visible width)
      const maxTextLen = contentWidth - 1 // 1 for space after icon
      let truncated = text
      let textVisLen = this.visibleLen(textStyle(text))
      if (textVisLen > maxTextLen) {
        // Simple truncation: cut raw text and add ellipsis
        truncated = `${text.slice(0, maxTextLen - 1)}\u2026`
        textVisLen = maxTextLen
      }
      const line = ` ${icon} ${textStyle(truncated)}`
      const visLen = this.visibleLen(line)
      const padding = Math.max(0, width - visLen)
      lines.push(line + ' '.repeat(padding))
    }

    return lines
  }
}
