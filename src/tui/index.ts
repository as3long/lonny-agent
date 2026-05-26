import * as fs from 'node:fs'
import * as path from 'node:path'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { loadTokenUsage, resetTokenUsage } from '../config/tokens.js'
import { PLAN_DIR } from '../tools/write_plan.js'
import type { Component, Focusable, OverlayHandle } from '@earendil-works/pi-tui'
import { ProcessTerminal, TUI, Box, Text, Input, Markdown, SelectList, Container, Loader, Spacer, CURSOR_MARKER, visibleWidth }
  from '@earendil-works/pi-tui'
import type { SelectItem, SelectListTheme, MarkdownTheme } from '@earendil-works/pi-tui'

// ── ANSI Color Helpers ───────────────────────────────────────────────────────

// Re-applies background after every full reset (\x1b[0m) so that foreground
// color resets don't "punch through" the background.
function safeBg(text: string, bg: string): string {
  return `\x1b[${bg}m${text.replace(/\x1b\[0m/g, `\x1b[0m\x1b[${bg}m`)}\x1b[0m`
}

const colors = {
  bgDark: (text: string) => safeBg(text, '48;2;30;30;30'),
  bgDim: (text: string) => safeBg(text, '48;2;25;25;25'),
  headerBg: (text: string) => safeBg(text, '48;2;25;25;35'),
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

// ── Pixel font for "lonnycode" logo (5 rows × 5 cols per char) ──────────

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

const PIXEL_LOGO_WIDTH = 54 // 5 cols × 9 chars + 8 gaps + 2 gap between words

function renderPixelLogo(): string[] {
  const midGray = '\x1b[38;2;160;160;160m'
  const brightWhite = '\x1b[38;2;255;255;255m'
  const reset = '\x1b[0m'
  const lines: string[] = []
  for (let row = 0; row < 5; row++) {
    const lonnyPart = LONNY_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    const codePart = CODE_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    lines.push(midGray + lonnyPart + '  ' + brightWhite + codePart + reset)
  }
  return lines
}

// ── Landing input colors ────────────────────────────────────────────────

const landingColors = {
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

interface PlanEntry {
  name: string
  description: string
  fullPath: string
  mtime: number
}

function listPlans(cwd: string): PlanEntry[] {
  const planDir = path.resolve(cwd, PLAN_DIR)
  try {
    const files = fs.readdirSync(planDir)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(planDir, f)
        let mtime = 0
        try { mtime = fs.statSync(fullPath).mtimeMs } catch { /* ignore */ }
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

function loadTodos(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const todos: string[] = []
    let inTodo = false
    for (const line of lines) {
      if (line.startsWith('## Todo List')) { inTodo = true; continue }
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

function plansToItems(plans: PlanEntry[]): SelectItem[] {
  return plans.map(p => ({ 
    value: p.name, 
    label: p.name, 
    description: p.mtime 
      ? `${new Date(p.mtime).toLocaleDateString()} ${new Date(p.mtime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` 
      : '' 
  }))
}

// ── OpenCode-style Header ────────────────────────────────────────────────

class HeaderBar implements Component {
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

  setMode(m: string): void { this.mode = m }
  setAgentStatus(s: 'running' | 'idle'): void { this.agentStatus = s }
  setPlanCount(n: number): void { this.planCount = n }
  setPlanName(n: string): void { this.planName = n }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setProjectName(name: string): void { this.projectName = name }
  invalidate(): void {}
  handleInput?(data: string): void {}

  render(width: number): string[] {
    const appName = colors.accent('\u2588 lonny')
    const statusDot = this.agentStatus === 'running'
      ? colors.running('\u25CF')
      : colors.dim('\u25CB')
    const statusLabel = this.agentStatus === 'running'
      ? colors.running('running')
      : colors.dim('idle')
    const modeLabel = colors.warn(this.mode)
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
    const padded = line.length < width ? line + ' '.repeat(width - line.length) : line
    return [colors.headerBg(padded), colors.dim('\u2500'.repeat(width))]
  }
}

// ── OpenCode-style Footer/Status ─────────────────────────────────────────

class FooterBar implements Component {
  private visible = true
  invalidate(): void {}
  handleInput?(data: string): void {}

  render(width: number): string[] {
    if (!this.visible || width < 40) return []
    const help = [
      colors.dim('/mode'),
      colors.dim('/plans'),
      colors.dim('/help'),
      colors.dim('?'),
    ].join(colors.dim(' · '))
    const line = ` ${colors.dim('?')} ${colors.dim('help')}  ${colors.dim('·')}  ${help}`
    const padded = line.length < width ? line + ' '.repeat(width - line.length) : line
    return [colors.statusBg(padded)]
  }
}

// ── Word-wrapping helpers for multi-line input ─────────────────────────

/** Split text into lines that fit within `maxWidth` visible columns. */
function wordWrap(text: string, maxWidth: number): string[] {
  if (!text) return ['']
  const lines: string[] = []
  let currentLine = ''
  for (const char of text) {
    if (char === '\n') {
      lines.push(currentLine)
      currentLine = ''
      continue
    }
    if (visibleWidth(currentLine + char) > maxWidth) {
      lines.push(currentLine)
      currentLine = char
    } else {
      currentLine += char
    }
  }
  lines.push(currentLine)
  return lines
}

/** Compute the (lineIndex, column) of `cursor` after word-wrapping. */
function cursorWrapPosition(
  text: string,
  cursor: number,
  maxWidth: number,
): { line: number; col: number } {
  const before = text.slice(0, cursor)
  const wrapped = wordWrap(before, maxWidth)
  return { line: wrapped.length - 1, col: visibleWidth(wrapped[wrapped.length - 1]) }
}

// ── LandingInput (custom styled input for landing screen) ──────────────

class LandingInput implements Component, Focusable {
  value = ''
  cursor = 0
  focused = false
  private readonly inputHeight = 3 // number of visible text rows
  onSubmit?: (value: string) => void

  getValue(): string {
    return this.value
  }

  setValue(val: string): void {
    this.value = val
    this.cursor = val.length
  }

  /** Compute the visual width of the input box (used by arrow navigation). */
  private getInnerWidth(): number {
    // This approximates the value computed in render() — we derive it here
    // without access to the terminal width by using a reasonable default.
    return 56 // boxWidth=60 minus 4 padding
  }

  /** Move cursor to the visual line above/below using word-wrapping. */
  private moveCursorVisualLine(direction: -1 | 1): void {
    if (!this.value) return
    const maxWidth = this.getInnerWidth()
    const beforeCursor = this.value.slice(0, this.cursor)
    const wrappedBefore = wordWrap(beforeCursor, maxWidth)
    const currentLine = wrappedBefore.length - 1
    const currentCol = visibleWidth(wrappedBefore[currentLine])

    // Word-wrap the entire value
    const wrappedAll = wordWrap(this.value, maxWidth)

    if (direction === -1 && currentLine > 0) {
      // Move up: go to previous visual line, keep same column
      const targetLine = currentLine - 1
      const targetLineText = wrappedAll[targetLine]
      // Calculate cursor position: end of previous line's characters up to currentCol
      let newCursor = 0
      for (let i = 0; i < targetLine; i++) {
        newCursor += wrappedAll[i].length
      }
      // Add the column position (trimmed to line length)
      const targetCol = Math.min(currentCol, visibleWidth(targetLineText))
      // Need to find the actual character index for this visual column
      let visualPos = 0
      let charIdx = 0
      while (charIdx < targetLineText.length && visualPos < targetCol) {
        visualPos += visibleWidth(targetLineText[charIdx])
        charIdx++
      }
      newCursor += charIdx
      this.cursor = newCursor
    } else if (direction === 1 && currentLine < wrappedAll.length - 1) {
      // Move down: go to next visual line
      const targetLine = currentLine + 1
      const targetLineText = wrappedAll[targetLine]
      let newCursor = 0
      for (let i = 0; i < targetLine; i++) {
        newCursor += wrappedAll[i].length
      }
      const targetCol = Math.min(currentCol, visibleWidth(targetLineText))
      let visualPos = 0
      let charIdx = 0
      while (charIdx < targetLineText.length && visualPos < targetCol) {
        visualPos += visibleWidth(targetLineText[charIdx])
        charIdx++
      }
      newCursor += charIdx
      this.cursor = newCursor
    }
  }

  handleInput(data: string): void {
    // Submit
    if (data === '\r' || data === '\n') {
      if (this.onSubmit) this.onSubmit(this.value)
      return
    }
    // Backspace
    if (data === '\x7f' || data === '\b') {
      if (this.cursor > 0) {
        this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor)
        this.cursor--
      }
      return
    }
    // Up arrow — move cursor up one visual line
    if (data === '\x1b[A') {
      this.moveCursorVisualLine(-1)
      return
    }
    // Down arrow — move cursor down one visual line
    if (data === '\x1b[B') {
      this.moveCursorVisualLine(1)
      return
    }
    // Left arrow
    if (data === '\x1b[D') { if (this.cursor > 0) this.cursor--; return }
    // Right arrow
    if (data === '\x1b[C') { if (this.cursor < this.value.length) this.cursor++; return }
    // Home
    if (data === '\x1b[H' || data === '\x1b[1~') { this.cursor = 0; return }
    // End
    if (data === '\x1b[F' || data === '\x1b[4~') { this.cursor = this.value.length; return }
    // Delete
    if (data === '\x1b[3~') {
      if (this.cursor < this.value.length) {
        this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1)
      }
      return
    }
    // Regular printable character
    const hasControl = [...data].some(ch => {
      const code = ch.charCodeAt(0)
      return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f)
    })
    if (!hasControl) {
      this.value = this.value.slice(0, this.cursor) + data + this.value.slice(this.cursor)
      this.cursor += data.length
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const boxWidth = Math.min(60, width - 4)
    const leftPad = Math.max(0, Math.floor((width - boxWidth) / 2))
    const innerWidth = boxWidth - 4 // 2 padding on each side

    const {
      inputBg, cyanBar, placeholderDim, placeholderQuote,
      inputText, reset,
    } = landingColors

    // ── Build top border ─────────────────────────────────────────────────
    const topBorder = ' '.repeat(leftPad) + inputBg + cyanBar + '\u2501' + reset +
      inputBg + '\u2501'.repeat(innerWidth) + reset
    const bottomBorder = ' '.repeat(leftPad) + inputBg + cyanBar + '\u2501' + reset +
      inputBg + '\u2501'.repeat(innerWidth) + reset

    // ── Word-wrap the value and determine which slice to show ────────────
    const wrappedAll = wordWrap(this.value, innerWidth)
    const cursorPos = this.value
      ? cursorWrapPosition(this.value, this.cursor, innerWidth)
      : { line: 0, col: 0 }

    // Scroll the visible window so the cursor line is visible.
    // Show `inputHeight` lines at a time, keeping the cursor line in view.
    const totalWrapped = wrappedAll.length
    let scrollOffset = 0
    if (totalWrapped > this.inputHeight) {
      // Try to center the cursor line in the window
      scrollOffset = Math.max(0, Math.min(
        cursorPos.line - Math.floor(this.inputHeight / 2),
        totalWrapped - this.inputHeight,
      ))
    }

    // Build each visible content line
    const contentLines: string[] = []
    for (let i = 0; i < this.inputHeight; i++) {
      const wrappedIdx = scrollOffset + i
      const lineText = wrappedIdx < totalWrapped ? wrappedAll[wrappedIdx] : ''
      const isEmpty = this.value === ''

      let lineContent: string

      if (isEmpty && i === 0 && wrappedIdx === 0) {
        // Placeholder on the first line when value is empty
        const placeholder =
          placeholderDim + 'Ask anything... ' +
          placeholderQuote + '"Fix a TODO in the codebase"' + reset
        const cursorMarker = this.focused ? CURSOR_MARKER : ''
        lineContent = cursorMarker + placeholder
      } else if (isEmpty) {
        // Empty additional lines — just background
        lineContent = ''
      } else if (this.focused && cursorPos.line === wrappedIdx) {
        // Cursor is on this visual line
        const beforeCursor = lineText.slice(0, cursorPos.col)
        const atCursor = lineText[cursorPos.col] || ' '
        const afterCursor = lineText.slice(cursorPos.col + 1)
        const cursorDisplay = `\x1b[7m${atCursor}\x1b[27m`
        lineContent = inputText + beforeCursor + CURSOR_MARKER + cursorDisplay + afterCursor + reset
      } else {
        // Regular line (no cursor)
        lineContent = lineText ? inputText + lineText + reset : ''
      }

      // Pad to innerWidth
      const lineWidth = visibleWidth(lineText || '')
      const padding = ' '.repeat(Math.max(0, innerWidth - lineWidth))

      const renderedLine = ' '.repeat(leftPad) + inputBg + cyanBar + '\u2502' + reset +
        inputBg + lineContent + inputBg + padding + reset

      contentLines.push(renderedLine)
    }

    return [topBorder, ...contentLines, bottomBorder]
  }
}

// ── LandingScreen (pixel logo + styled input) ──────────────────────────

class LandingScreen implements Component {
  private input: LandingInput
  onSubmit?: (value: string) => void

  constructor(input: LandingInput) {
    this.input = input
    this.input.onSubmit = (value: string) => {
      if (this.onSubmit) this.onSubmit(value)
    }
  }

  getInput(): LandingInput {
    return this.input
  }

  invalidate(): void {
    this.input.invalidate()
  }

  handleInput(data: string): void {
    this.input.handleInput(data)
  }

  render(width: number): string[] {
    const lines: string[] = []

    // ── Pixel logo ─────────────────────────────────────────────────────
    const logoLines = renderPixelLogo()
    const logoPad = Math.max(0, Math.floor((width - PIXEL_LOGO_WIDTH) / 2))
    const padStr = ' '.repeat(logoPad)

    for (const line of logoLines) {
      lines.push(padStr + line)
    }

    // ── Blank line ─────────────────────────────────────────────────────
    lines.push('')

    // ── Input box ──────────────────────────────────────────────────────
    const inputLines = this.input.render(width)
    lines.push(...inputLines)

    return lines
  }
}

// ── PlansList wrapper (SelectList has no setItems) ───────────────────────

class PlansList implements Component {
  private selectList: SelectList
  private maxVisible: number
  private theme: SelectListTheme
  private allItems: SelectItem[] = []
  onSelectionChange?: (item: SelectItem) => void

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.allItems = items
    this.selectList = new SelectList(items, maxVisible, theme)
    this.maxVisible = maxVisible
    this.theme = theme
    this.selectList.onSelectionChange = (item) => {
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

// ── StatusBar (bottom bar: cwd | status | version) ─────────────────────

class StatusBar implements Component {
  private cwd: string
  private status: string = ''
  private visible = true

  constructor(cwd: string) {
    this.cwd = cwd
  }

  setStatus(s: string): void { this.status = s }
  setVisible(v: boolean): void { this.visible = v }

  invalidate(): void {}
  handleInput?(data: string): void {}

  render(width: number): string[] {
    if (!this.visible || width < 40) return []

    const { statusBg, statusText, statusAccent, reset } = landingColors

    // Left: working directory
    const dir = this.cwd.length > 30 ? '...' + this.cwd.slice(-27) : this.cwd
    const leftPart = statusAccent + '\u25A0' + reset + statusBg + statusText + ' ' + dir + reset

    // Center: status message
    const centerPart = this.status
      ? statusBg + statusText + '  ' + this.status + '  ' + reset
      : statusBg + statusText + '  ready  ' + reset

    // Right: version
    const rightPart = statusBg + statusText + 'v' + APP_VERSION + ' ' + reset

    const line = leftPart + centerPart + rightPart
    const padded = line.length < width
      ? line + statusBg + ' '.repeat(width - line.length) + reset
      : line

    return [padded]
  }
}

// ── startTui ─────────────────────────────────────────────────────────────

export async function startTui(config: Config): Promise<void> {
  let chatContent = ''
  let isRunning = false
  let session: Session
  let filterMode = false

  // ── Create markdown theme (OpenCode-style, clean colors) ───────────────
  const markdownTheme: MarkdownTheme = {
    heading: (t) => `\x1b[38;2;0;170;255m\x1b[1m${t}\x1b[0m`,
    link: (t) => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
    linkUrl: (t) => `\x1b[38;2;90;90;90m\x1b[4m${t}\x1b[0m`,
    code: (t) => `\x1b[38;2;255;180;50m${t}\x1b[0m`,
    codeBlock: (t) => `\x1b[38;2;200;200;200m${t}\x1b[0m`,
    codeBlockBorder: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    quote: (t) => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    quoteBorder: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    hr: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    listBullet: (t) => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    bold: (t) => `\x1b[1m${t}\x1b[0m`,
    italic: (t) => `\x1b[3m${t}\x1b[0m`,
    strikethrough: (t) => `\x1b[9m${t}\x1b[0m`,
    underline: (t) => `\x1b[4m${t}\x1b[0m`,
  }

  // ── Create select list theme ───────────────────────────────────────────
  const selectTheme: SelectListTheme = {
    selectedPrefix: (t) => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m ${t}\x1b[0m`,
    selectedText: (t) => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m${t}\x1b[0m`,
    description: (t) => `\x1b[90m${t}\x1b[0m`,
    scrollInfo: (t) => `\x1b[90m${t}\x1b[0m`,
    noMatch: (t) => `\x1b[38;2;255;100;100m${t}\x1b[0m`,
  }

  // ── Create terminal and TUI ────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal, true)
  tui.setClearOnShrink(true)
  terminal.setTitle(`lonny ${config.model} ${config.provider}`)

  // ── Create components (OpenCode-style layout) ──────────────────────────

  // Top header bar
  const header = new HeaderBar(config.model, config.provider)
  tui.showOverlay(header, { anchor: 'top-left', row: 0, col: 0, nonCapturing: true })

  // Chat area (full width, no side panel) — created upfront but only added
  // to the TUI after the landing screen transitions to chat mode.
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  const chatBox = new Box(1, 0)
  chatBox.addChild(chatMarkdown)

  // Chat input — created upfront, added to TUI after landing transition
  const input = new Input()

  // Loader (thinking indicator)
  const loader = new Loader(tui, colors.running, colors.idle, 'thinking...', { intervalMs: 80 })

  // Bottom footer bar
  const footer = new FooterBar()

  // ── Build layout (landing phase) ───────────────────────────────────────
  // In the landing phase, only the Spacer (for header overlay offset) and
  // the header bar are shown. The chatBox, input, loader, and footer are
  // added after the first message (see landingScreen.onSubmit).
  tui.addChild(new Spacer(1)) // offset for fixed header overlay

  // ── Plan written callback (defined early since it's used by session restore) ──
  const planCb = () => {
    refreshPlans()
    if (plansOverlayHandle?.isHidden() === false) {
      showPlansOverlay()
    }
  }

  // ── Session output ─────────────────────────────────────────────────────
  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.setText(chatContent)
    },
  }

  // Try to restore a saved session for this directory (MUST be before landing screen setup)
  let restored = false
  const restoredSession = Session.load(config, output)
  if (restoredSession) {
    restored = true
    session = restoredSession
    session.onPlanWritten = planCb
    // Find the last user message from the previous session
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    const lastQuestion = lastUserMsg && typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : null
    chatContent = '\n' + colors.dim('\u21BA Resumed previous session')
    if (lastQuestion) {
      const preview = lastQuestion.length > 80 ? lastQuestion.slice(0, 80) + '\u2026' : lastQuestion
      chatContent += ` \u2014 ${colors.userLabel(preview)}`
    }
    chatContent += '\n\n'
    chatMarkdown.setText(chatContent)
  } else {
    session = new Session(config, output)
    session.onPlanWritten = planCb
  }

  // ── Status bar (bottom bar: cwd | status | version) ──────────────────
  const statusBar = new StatusBar(config.cwd)
  const statusBarHandle = tui.showOverlay(statusBar, {
    anchor: 'bottom-left',
    row: 0,
    col: 0,
    nonCapturing: true,
  })

  // ── Landing screen (centered overlay with pixel logo + styled input) ──
  const landingInput = new LandingInput()
  const landingScreen = new LandingScreen(landingInput)
  let landingOverlayHandle: OverlayHandle | null = null
  // Only show the landing screen if no session was restored
  if (!restored) {
    landingOverlayHandle = tui.showOverlay(landingScreen, {
      anchor: 'center',
      width: 70,
      maxHeight: 14,
    })
    // Focus the landing input so it receives keyboard input and shows the cursor
    tui.setFocus(landingInput)
  }

  // If a session was restored, immediately transition to chat layout
  // (skip the landing screen)
  if (restored) {
    statusBarHandle.hide()
    tui.addChild(chatBox)
    tui.addChild(input)
    tui.addChild(loader)
    tui.addChild(footer)
    tui.setFocus(input)
  }

  // ── Plans overlay components ───────────────────────────────────────────
  const plansList = new PlansList([], 15, selectTheme)
  let plansOverlayHandle: OverlayHandle | null = null

  function showPlansOverlay(): void {
    if (plansOverlayHandle?.isHidden() === false) {
      plansOverlayHandle.hide()
      plansOverlayHandle = null
      return
    }
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))

    const headerText = new Text(
      ` ${colors.accent('\u25B6')} Plans (${plans.length})`,
      1, 0, colors.headerBg
    )
    const container = new Container()
    container.addChild(headerText)
    if (plans.length > 0) {
      container.addChild(plansList)
    } else {
      container.addChild(new Text('  (no plans yet)', 1, 0, colors.dim))
    }

    const box = new Box(1, 1, colors.bgDark)
    box.addChild(container)

    plansOverlayHandle = tui.showOverlay(box, {
      anchor: 'right-center',
      width: 45,
      maxHeight: '70%',
      offsetX: -1,
    })
  }

  // ── Help overlay ───────────────────────────────────────────────────────────
  let helpOverlayHandle: OverlayHandle | null = null

  function showHelpOverlay(): void {
    if (helpOverlayHandle?.isHidden() === false) {
      helpOverlayHandle.hide()
      helpOverlayHandle = null
      return
    }
    const helpContent =
      colors.accent('\u2501').repeat(20) + '\n' +
      ` ${colors.accent('lonny')} ${colors.dim('TUI Help')}\n` +
      colors.accent('\u2501').repeat(20) + '\n\n' +
      ` ${colors.dim('Commands:')}\n` +
      `   ${colors.inputPrompt('/mode')} code|plan  ${colors.dim('Switch mode')}\n` +
      `   ${colors.inputPrompt('/plans')}          ${colors.dim('Show plans overlay')}\n` +
      `   ${colors.inputPrompt('/new')}            ${colors.dim('Start a new session')}\n` +
      `   ${colors.inputPrompt('/exit')}           ${colors.dim('Exit')}\n` +
      `   ${colors.inputPrompt('/help')}           ${colors.dim('This help')}\n\n` +
      ` ${colors.dim('Keyboard:')}\n` +
      `   ${colors.dim('Enter')}        ${colors.dim('Send message')}\n` +
      `   ${colors.dim('↑/↓')}          ${colors.dim('Navigate history')}\n` +
      `   ${colors.dim('Tab')}          ${colors.dim('Autocomplete')}\n` +
      `   ${colors.dim('?')}            ${colors.dim('Toggle this help')}\n\n` +
      colors.accent('\u2501').repeat(20)
    const helpText = new Text(helpContent, 1, 0)
    const helpBox = new Box(1, 1, colors.bgDark)
    helpBox.addChild(helpText)
    helpOverlayHandle = tui.showOverlay(helpBox, {
      anchor: 'center',
      width: 46,
      maxHeight: 22,
    })
  }

  // ── Update helpers ──────────────────────────────────────────────────────
  function updateHeader(): void {
    const plans = listPlans(config.cwd)
    header.setMode(session?.config.mode === 'plan' ? 'plan' : 'code')
    header.setAgentStatus(isRunning ? 'running' : 'idle')
    header.setPlanCount(plans.length)
    const sel = plansList.getSelectedItem()
    header.setPlanName(sel ? sel.label : '')
    // Load persisted token stats (cumulative across all sessions for this project)
    const tokenStats = loadTokenUsage(config.cwd)
    header.setProjectName(tokenStats.projectName)
    header.setTokenUsage(tokenStats.totalInputTokens, tokenStats.totalOutputTokens, tokenStats.totalApiCalls)
    tui.requestRender(true)
  }

  function refreshPlans(): void {
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))
    updateHeader()
  }

  // ── Input handling ──────────────────────────────────────────────────────
  function sendMessage(text: string): void {
    if (!text.trim() || isRunning) return
    const trimmed = text.trim()
    input.setValue('')

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const arg = parts.slice(1).join(' ')

      if (cmd === 'exit' || cmd === 'quit') {
        chatContent += `\n${colors.dim('Goodbye!')}\n`
        chatMarkdown.setText(chatContent)
        tui.stop()
        process.exit(0)
        return
      }

      if (cmd === 'new') {
        Session.clearSavedSession(config.cwd)
        resetTokenUsage(config.cwd)
        session = new Session(config, output)
        session.onPlanWritten = planCb
        chatContent = ''
        chatMarkdown.setText('')
        updateHeader()
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          chatContent += `\n${colors.warn('\u21E8')} Switched to ${colors.warn(arg)} mode\n`
          chatMarkdown.setText(chatContent)
          updateHeader()
        } else {
          chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/mode code|plan')}  (current: ${session.config.mode})\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      if (cmd === 'plans') {
        showPlansOverlay()
        return
      }

      if (cmd === 'filter') {
        plansList.setFilter(arg)
        tui.requestRender(true)
        return
      }

      if (cmd === 'help' || cmd === '?') {
        showHelpOverlay()
        return
      }

      chatContent += `\n${colors.error('\u2716')} Unknown command: /${cmd}. ${colors.dim('Type /help for available commands.')}\n`
      chatMarkdown.setText(chatContent)
      return
    }

    isRunning = true
    loader.setMessage('thinking...')
    updateHeader()

    session.chat(trimmed).then(() => {
      isRunning = false
      loader.setMessage('')
      refreshPlans()
      updateHeader()
    }).catch((err: unknown) => {
      isRunning = false
      loader.setMessage('')
      const errMsg = err instanceof Error ? err.message : String(err)
      chatContent += `\n${colors.error('\u2716 Error:')} ${errMsg}\n`
      chatMarkdown.setText(chatContent)
      updateHeader()
    })
  }

  // Wire up Enter on chat input (after landing transition)
  input.onSubmit = (value: string) => {
    sendMessage(value)
  }

  // ── Landing screen transition ────────────────────────────────────────────
  // When the user submits from the landing screen, hide the overlay, add
  // the chat components to the main TUI, and process the message.
  landingScreen.onSubmit = (value: string) => {
    if (!value.trim() || isRunning) return

    // Hide the landing overlay — this also restores focus to the previous
    // target (the Spacer), but we immediately set focus to the chat input.
    if (landingOverlayHandle) landingOverlayHandle.hide()
    statusBarHandle.hide()

    // Add chat components to the main TUI
    tui.addChild(chatBox)
    tui.addChild(input)
    tui.addChild(loader)
    tui.addChild(footer)

    // Focus the chat input
    tui.setFocus(input)
    tui.requestRender(true)

    // Process the message through the normal flow
    sendMessage(value)
  }

  // ── Input listener ───────────────────────────────────────────────────────
  tui.addInputListener((data) => {
    // Check if help overlay is active
    if (helpOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[' || data === '?') {
        helpOverlayHandle.hide()
        helpOverlayHandle = null
      }
      return { consume: true }
    }

    // Check if plans overlay is active
    if (plansOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[' || data === '/') {
        plansOverlayHandle.hide()
        plansOverlayHandle = null
      }
      if (data === '\x1b[A') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx <= 0 ? plans.length - 1 : idx - 1
          plansList.setSelectedIndex(nextIdx)
          updateHeader()
        }
        return { consume: true }
      }
      if (data === '\x1b[B') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx === -1 ? 0 : (idx + 1) % plans.length
          plansList.setSelectedIndex(nextIdx)
          updateHeader()
        }
        return { consume: true }
      }
      return { consume: true }
    }

    if (data === '?') {
      showHelpOverlay()
      return { consume: true }
    }

    if (data === '/') {
      if (filterMode) {
        filterMode = false
        plansList.clearFilter()
        return undefined
      }
      filterMode = true
      plansList.setFilter('')
      return { consume: true }
    }

    return undefined
  })

  // ── Initial render ─────────────────────────────────────────────────────
  loader.setMessage('')
  refreshPlans()

  // If no session was restored, keep the landing screen and clear chat.
  // If a session was restored, chatContent already has the resume message.
  if (!restored) {
    chatMarkdown.setText('')
  }

  tui.start()

  // Keep alive
  await new Promise<void>(() => {})
}