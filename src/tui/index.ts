import * as fs from 'node:fs'
import * as path from 'node:path'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { setOnPlanWritten, PLAN_DIR } from '../tools/write_plan.js'
import type { Component, OverlayHandle } from '@earendil-works/pi-tui'
import { ProcessTerminal, TUI, Box, Text, Input, Markdown, SelectList, Container, Loader }
  from '@earendil-works/pi-tui'
import type { SelectItem, SelectListTheme, MarkdownTheme } from '@earendil-works/pi-tui'

// ── ANSI Color Helpers ───────────────────────────────────────────────────────
const colors = {
  bgDark: (text: string) => `\x1b[48;2;30;30;30m${text}\x1b[0m`,
  bgDim: (text: string) => `\x1b[48;2;25;25;25m${text}\x1b[0m`,
  headerBg: (text: string) => `\x1b[48;2;18;18;18m${text}\x1b[0m`,
  separator: (text: string) => `\x1b[38;2;60;60;60m${text}\x1b[0m`,
  statusBg: (text: string) => `\x1b[48;2;18;18;18m${text}\x1b[0m`,
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
      .sort((a, b) => (b as any).mtime - (a as any).mtime)
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
    if (this.planCount > 0) {
      rightPart += `  ${colors.dim('|')}  ${colors.accent(`${this.planCount} plan${this.planCount > 1 ? 's' : ''}`)}`
      if (this.planName) rightPart += ` ${colors.dim(this.planName)}`
    }

    const line = ` ${appName}  ${colors.dim('·')}  ${rightPart}`
    const padded = line.length < width ? line + ' '.repeat(width - line.length) : line
    return [colors.headerBg(padded)]
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

  // Chat area (full width, no side panel)
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  const chatBox = new Box(1, 0)
  chatBox.addChild(chatMarkdown)

  // Input with OpenCode-style prompt
  const input = new Input()
  // Set the input prompt symbol (the Input component may support this)

  // Loader (thinking indicator)
  const loader = new Loader(tui, colors.running, colors.idle, 'thinking...', { intervalMs: 80 })

  // Bottom footer bar
  const footer = new FooterBar()

  // ── Build layout ───────────────────────────────────────────────────────
  tui.addChild(header)
  tui.addChild(chatBox)
  tui.addChild(input)
  tui.addChild(loader)
  tui.addChild(footer)

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

  // Wire up Enter on input
  input.onSubmit = (value: string) => {
    sendMessage(value)
  }

  // ── Plan written callback ────────────────────────────────────────────────
  setOnPlanWritten(() => {
    refreshPlans()
    // Refresh plans overlay if visible
    if (plansOverlayHandle?.isHidden() === false) {
      showPlansOverlay()
    }
  })

  // ── Session output ─────────────────────────────────────────────────────
  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.setText(chatContent)
    },
  }

  session = new Session(config, output)

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

  // Show welcome message
  chatContent = `${colors.dim('Welcome to')} ${colors.accent('lonny')} ${colors.dim('- a coding agent optimized for per-call pricing')}\n`
  chatContent += `${colors.dim('Type')} ${colors.inputPrompt('/help')} ${colors.dim('for available commands or')} ${colors.inputPrompt('?')} ${colors.dim('for keyboard shortcuts')}\n`
  chatMarkdown.setText(chatContent)

  tui.start()
  tui.setFocus(input)

  // Keep alive
  await new Promise<void>(() => {})
}