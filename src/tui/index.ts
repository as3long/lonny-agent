import * as fs from 'node:fs'
import * as path from 'node:path'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { setOnPlanWritten, PLAN_DIR } from '../tools/write_plan.js'
import type { Component } from '@earendil-works/pi-tui'
import { ProcessTerminal, TUI, Box, Text, Input, Markdown, SelectList, Container }
  from '@earendil-works/pi-tui'
import type { SelectItem, SelectListTheme, MarkdownTheme } from '@earendil-works/pi-tui'

// ── Helpers ──────────────────────────────────────────────────────────────

interface PlanEntry {
  name: string
  description: string
  fullPath: string
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
      .map(({ name, description, fullPath }) => ({ name, description, fullPath }))
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
          todos.push(`${done ? '\u2705' : '\u2B1C'} ${m[2]}`)
        }
      }
    }
    return todos.length > 0 ? todos.join('\n') : '(no todo items)'
  } catch {
    return '(no plan selected)'
  }
}

function plansToItems(plans: PlanEntry[]): SelectItem[] {
  return plans.map(p => ({ value: p.name, label: p.name, description: p.description }))
}

// ── SplitLayout ──────────────────────────────────────────────────────────

class SplitLayout implements Component {
  left: Component
  right: Component | null
  rightWidthRatio: number
  minWidthForRight: number

  constructor(left: Component, right: Component | null, rightWidthRatio = 0.3, minWidthForRight = 100) {
    this.left = left
    this.right = right
    this.rightWidthRatio = rightWidthRatio
    this.minWidthForRight = minWidthForRight
  }

  setRight(component: Component | null): void {
    this.right = component
  }

  invalidate(): void {
    this.left.invalidate()
    if (this.right) this.right.invalidate()
  }

  render(width: number): string[] {
    if (!this.right || width < this.minWidthForRight) {
      return this.left.render(width)
    }
    const leftWidth = Math.floor(width * (1 - this.rightWidthRatio))
    const rightWidth = width - leftWidth
    const leftLines = this.left.render(leftWidth)
    const rightLines = this.right.render(rightWidth)
    const maxLines = Math.max(leftLines.length, rightLines.length)
    const lines: string[] = []
    for (let i = 0; i < maxLines; i++) {
      const leftLine = i < leftLines.length ? leftLines[i] : ''.padEnd(leftWidth)
      const rightLine = i < rightLines.length ? rightLines[i] : ''.padEnd(rightWidth)
      lines.push(leftLine + rightLine)
    }
    return lines
  }
}

// ── PlansList wrapper (SelectList has no setItems) ───────────────────────

class PlansList implements Component {
  private selectList: SelectList
  private maxVisible: number
  private theme: SelectListTheme
  onSelectionChange?: (item: SelectItem) => void

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.selectList = new SelectList(items, maxVisible, theme)
    this.maxVisible = maxVisible
    this.theme = theme
    this.selectList.onSelectionChange = (item) => {
      if (this.onSelectionChange) this.onSelectionChange(item)
    }
  }

  refresh(items: SelectItem[]): void {
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
}

// ── startTui ─────────────────────────────────────────────────────────────

export async function startTui(config: Config): Promise<void> {
  let chatContent = ''
  let isRunning = false
  let session: Session

  // ── Create markdown theme ──────────────────────────────────────────────
  const markdownTheme: MarkdownTheme = {
    heading: (t) => `\x1b[38;2;0;170;255m\x1b[1m${t}\x1b[0m`,
    link: (t) => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
    linkUrl: (t) => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
    code: (t) => `\x1b[38;2;255;215;0m${t}\x1b[0m`,
    codeBlock: (t) => `\x1b[38;2;255;215;0m${t}\x1b[0m`,
    codeBlockBorder: (t) => t,
    quote: (t) => t,
    quoteBorder: (t) => `\x1b[38;2;128;128;128m${t}\x1b[0m`,
    hr: (t) => `\x1b[38;2;128;128;128m${t}\x1b[0m`,
    listBullet: (t) => t,
    bold: (t) => `\x1b[1m${t}\x1b[0m`,
    italic: (t) => `\x1b[3m${t}\x1b[0m`,
    strikethrough: (t) => `\x1b[9m${t}\x1b[0m`,
    underline: (t) => `\x1b[4m${t}\x1b[0m`,
  }

  // ── Create select list theme ───────────────────────────────────────────
  const selectTheme: SelectListTheme = {
    selectedPrefix: (t) => `\x1b[7m ${t}\x1b[0m`,
    selectedText: (t) => `\x1b[7m${t}\x1b[0m`,
    description: (t) => `\x1b[90m${t}\x1b[0m`,
    scrollInfo: (t) => `\x1b[90m${t}\x1b[0m`,
    noMatch: (t) => `\x1b[90m${t}\x1b[0m`,
  }

  // ── Create terminal and TUI ────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal, true)
  tui.setClearOnShrink(true)
  terminal.setTitle(`lonny ${config.model} ${config.provider}`)

  // ── Create components ──────────────────────────────────────────────────
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  const chatBox = new Box(0, 0)
  chatBox.addChild(chatMarkdown)

  const plansHeader = new Text(' Plans', 1, 0)
  const plansList = new PlansList([], 10, selectTheme)
  const todoHeader = new Text(' Todos', 1, 0)
  const todoText = new Text('(no plan selected)', 1, 0)

  const sideContainer = new Container()
  sideContainer.addChild(plansHeader)
  sideContainer.addChild(plansList)
  sideContainer.addChild(todoHeader)
  sideContainer.addChild(todoText)
  const sideBox = new Box(0, 0)
  sideBox.addChild(sideContainer)

  const splitLayout = new SplitLayout(chatBox, sideBox, 0.3, 100)

  const input = new Input()

  const statusText = new Text('', 1, 0)

  // ── Build layout ───────────────────────────────────────────────────────
  tui.addChild(splitLayout)
  tui.addChild(input)
  tui.addChild(statusText)

  // ── Update status helper ────────────────────────────────────────────────
  function updateStatus(): void {
    const plans = listPlans(config.cwd)
    const modeLabel = session?.config.mode === 'plan' ? 'plan' : 'code'
    const runStatus = isRunning ? 'running' : 'idle'
    const sel = plansList.getSelectedItem()
    const planName = sel ? sel.label : ''
    let s = ` ${runStatus}  |  mode: ${modeLabel}  |  plans: ${plans.length}`
    if (planName) s += `  |  plan: ${planName}`
    statusText.setText(s)
  }

  function refreshPlans(): void {
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))
    updateStatus()
  }

  function loadTodosForSelected(): void {
    const sel = plansList.getSelectedItem()
    if (sel) {
      const entry = listPlans(config.cwd).find(p => p.name === sel.value)
      if (entry) {
        todoText.setText(loadTodos(entry.fullPath))
      }
    } else {
      todoText.setText('(no plan selected)')
    }
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
        chatContent += `\nGoodbye!\n`
        chatMarkdown.setText(chatContent)
        tui.stop()
        process.exit(0)
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          chatContent += `\nSwitched to ${arg} mode\n`
          chatMarkdown.setText(chatContent)
          updateStatus()
        } else {
          chatContent += `\nUsage: /mode code|plan  (current: ${session.config.mode})\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      chatContent += `\nUnknown command: /${cmd}\n`
      chatMarkdown.setText(chatContent)
      return
    }

    isRunning = true
    updateStatus()

    session.chat(trimmed).then(() => {
      isRunning = false
      refreshPlans()
      loadTodosForSelected()
      updateStatus()
    }).catch((err: unknown) => {
      isRunning = false
      chatContent += `\nError: ${err instanceof Error ? err.message : String(err)}\n`
      chatMarkdown.setText(chatContent)
      updateStatus()
    })
  }

  // Wire up Enter on input
  input.onSubmit = (value: string) => {
    sendMessage(value)
  }

  // ── Plans selection ─────────────────────────────────────────────────────
  plansList.onSelectionChange = () => {
    loadTodosForSelected()
    updateStatus()
  }

  // ── Plan written callback ────────────────────────────────────────────────
  setOnPlanWritten(() => {
    refreshPlans()
    loadTodosForSelected()
  })

  // ── Session output ─────────────────────────────────────────────────────
  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.setText(chatContent)
    },
  }

  session = new Session(config, output)

  // ── Resize handling ─────────────────────────────────────────────────────
  function syncSidePanelVisibility(): void {
    const cols = terminal.columns
    if (cols < 100 && splitLayout.right) {
      splitLayout.setRight(null)
    } else if (cols >= 100 && !splitLayout.right) {
      splitLayout.setRight(sideBox)
    }
  }

  tui.addInputListener((data) => {
    syncSidePanelVisibility()

    if (data === '\x1b[A') {
      const plans = listPlans(config.cwd)
      if (plans.length > 0) {
        const sel = plansList.getSelectedItem()
        const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
        const nextIdx = idx <= 0 ? plans.length - 1 : idx - 1
        plansList.setSelectedIndex(nextIdx)
        loadTodosForSelected()
        updateStatus()
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
        loadTodosForSelected()
        updateStatus()
      }
      return { consume: true }
    }
    return undefined
  })

  // Poll for terminal resize (input listener only fires on keyboard input)
  const resizeInterval = setInterval(syncSidePanelVisibility, 500)

  // ── Initial render ─────────────────────────────────────────────────────
  refreshPlans()
  updateStatus()

  tui.start()
  tui.setFocus(input)

  // Keep alive
  await new Promise<void>(() => {})
}
