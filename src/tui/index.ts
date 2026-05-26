import * as fs from 'node:fs'
import * as path from 'node:path'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { setOnPlanWritten, PLAN_DIR } from '../tools/write_plan.js'
import type {
  CliRenderer,
  BoxRenderable as BoxRenderableType,
  TextRenderable as TextRenderableType,
  InputRenderable as InputRenderableType,
  ScrollBoxRenderable as ScrollBoxRenderableType,
  SelectRenderable as SelectRenderableType,
  MarkdownRenderable as MarkdownRenderableType,
  SyntaxStyle as SyntaxStyleType,
  KeyEvent,
} from '@opentui/core'

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
          todos.push(`${done ? '✅' : '⬜'} ${m[2]}`)
        }
      }
    }
    return todos.length > 0 ? todos.join('\n') : '(no todo items)'
  } catch {
    return '(no plan selected)'
  }
}

// ── startTui ─────────────────────────────────────────────────────────────

export async function startTui(config: Config): Promise<void> {
  const {
    SyntaxStyle,
    createCliRenderer,
    BoxRenderable,
    TextRenderable,
    InputRenderable,
    ScrollBoxRenderable,
    SelectRenderable,
    SelectRenderableEvents: SelectRenderableEventsVal,
    MarkdownRenderable,
  } = await import('@opentui/core') as typeof import('@opentui/core')

  let chatContent = ''
  let isRunning = false
  let session: Session

  // ── Syntax style for markdown ───────────────────────────────────────────
  const syntaxStyle = SyntaxStyle.create()
  syntaxStyle.registerStyle('default', { fg: '#E0E0E0' })
  syntaxStyle.registerStyle('heading', { fg: '#00AAFF', bold: true })
  syntaxStyle.registerStyle('strong', { bold: true })
  syntaxStyle.registerStyle('code', { fg: '#FFD700' })
  syntaxStyle.registerStyle('link', { fg: '#00AAFF', underline: true })
  syntaxStyle.registerStyle('list', { fg: '#E0E0E0' })

  // ── Create renderer ─────────────────────────────────────────────────────
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useMouse: true,
    clearOnShutdown: true,
  })

  // Setup terminal title
  renderer.setTerminalTitle(`lonny ${config.model} ${config.provider}`)

  // ── Layout components ───────────────────────────────────────────────────
  const root = renderer.root

  // Main content area (chat + side panel)
  const mainContent = new BoxRenderable(renderer, {
    id: 'main-content',
    flexGrow: 1,
    flexDirection: 'row',
  })
  root.add(mainContent)

  // Left: chat scroll box with markdown
  const chatScroll = new ScrollBoxRenderable(renderer, {
    id: 'chat-scroll',
    flexGrow: 1,
    scrollY: true,
    viewportCulling: true,
  })
  mainContent.add(chatScroll)

  const chatMarkdown = new MarkdownRenderable(renderer, {
    id: 'chat-markdown',
    syntaxStyle,
    flexGrow: 1,
    streaming: false,
    content: '',
  })
  chatScroll.add(chatMarkdown)

  // Right: side panel (plans + todos)
  const sidePanel = new BoxRenderable(renderer, {
    id: 'side-panel',
    width: '30%',
    flexDirection: 'column',
    visible: renderer.width >= 100,
  })
  mainContent.add(sidePanel)

  // Plans header
  const plansHeader = new TextRenderable(renderer, {
    id: 'plans-header',
    content: ' Plans',
    fg: '#888888',
  })
  sidePanel.add(plansHeader)

  // Plans list (Select)
  const plansSelect = new SelectRenderable(renderer, {
    id: 'plans-select',
    flexGrow: 1,
    options: [],
    showScrollIndicator: true,
    showDescription: false,
  })
  sidePanel.add(plansSelect)

  // Todo header
  const todoHeader = new TextRenderable(renderer, {
    id: 'todo-header',
    content: ' Todos',
    fg: '#888888',
  })
  sidePanel.add(todoHeader)

  // Todo content
  const todoScroll = new ScrollBoxRenderable(renderer, {
    id: 'todo-scroll',
    flexGrow: 1,
    scrollY: true,
  })
  sidePanel.add(todoScroll)

  const todoText = new TextRenderable(renderer, {
    id: 'todo-text',
    content: '(no plan selected)',
    fg: '#AAAAAA',
  })
  todoScroll.add(todoText)

  // Input bar
  const inputBar = new BoxRenderable(renderer, {
    id: 'input-bar',
    height: 1,
    flexDirection: 'row',
  })
  root.add(inputBar)

  const input = new InputRenderable(renderer, {
    id: 'input',
    flexGrow: 1,
    placeholder: 'Type a message...',
  })
  inputBar.add(input)

  // Status bar
  const statusBar = new BoxRenderable(renderer, {
    id: 'status-bar',
    height: 1,
    flexDirection: 'row',
  })
  root.add(statusBar)

  const statusText = new TextRenderable(renderer, {
    id: 'status-text',
    flexGrow: 1,
    content: '',
  })
  statusBar.add(statusText)

  // ── Update status helper ────────────────────────────────────────────────
  function updateStatus(): void {
    const plans = listPlans(config.cwd)
    const modeLabel = session?.config.mode === 'plan' ? 'plan' : 'code'
    const runStatus = isRunning ? 'running' : 'idle'
    const sel = plansSelect.getSelectedOption()
    const planName = sel ? sel.name : ''
    let s = ` ${runStatus}  |  mode: ${modeLabel}  |  plans: ${plans.length}`
    if (planName) s += `  |  plan: ${planName}`
    statusText.content = s
  }

  function refreshPlans(): void {
    const plans = listPlans(config.cwd)
    plansSelect.options = plans.map(p => ({ name: p.name, description: p.description }))
    updateStatus()
  }

  function loadTodosForSelected(): void {
    const sel = plansSelect.getSelectedOption()
    if (sel) {
      const entry = listPlans(config.cwd).find(p => p.name === sel.name)
      if (entry) {
        todosText = loadTodos(entry.fullPath)
      }
    } else {
      todosText = '(no plan selected)'
    }
    todoText.content = todosText
  }

  let todosText = '(no plan selected)'

  // ── Input handling ──────────────────────────────────────────────────────
  function sendMessage(text: string): void {
    if (!text.trim() || isRunning) return
    const trimmed = text.trim()
    input.value = ''

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const arg = parts.slice(1).join(' ')

      if (cmd === 'exit' || cmd === 'quit') {
        chatContent += `\nGoodbye!\n`
        chatMarkdown.content = chatContent
        renderer.destroy()
        process.exit(0)
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          chatContent += `\nSwitched to ${arg} mode\n`
          chatMarkdown.content = chatContent
          updateStatus()
        } else {
          chatContent += `\nUsage: /mode code|plan  (current: ${session.config.mode})\n`
          chatMarkdown.content = chatContent
        }
        return
      }

      chatContent += `\nUnknown command: /${cmd}\n`
      chatMarkdown.content = chatContent
      return
    }

    isRunning = true
    chatMarkdown.streaming = true
    updateStatus()

    session.chat(trimmed).then(() => {
      isRunning = false
      chatMarkdown.streaming = false
      refreshPlans()
      loadTodosForSelected()
      updateStatus()
    }).catch((err: unknown) => {
      isRunning = false
      chatMarkdown.streaming = false
      chatContent += `\nError: ${err instanceof Error ? err.message : String(err)}\n`
      chatMarkdown.content = chatContent
      updateStatus()
    })
  }

  // Wire up Enter on input
  input.onKeyDown = (key: KeyEvent) => {
    if (key.name === 'return' && !key.shift && !isRunning) {
      sendMessage(input.value)
      return true
    }
    return false
  }

  // ── Plans selection ─────────────────────────────────────────────────────
  plansSelect.on(SelectRenderableEventsVal.SELECTION_CHANGED, () => {
    loadTodosForSelected()
    updateStatus()
  })

  // ── Plan written callback ───────────────────────────────────────────────
  setOnPlanWritten(() => {
    refreshPlans()
    loadTodosForSelected()
  })

  // ── Session output ─────────────────────────────────────────────────────
  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.content = chatContent
    },
  }

  session = new Session(config, output)

  // ── Resize handling ────────────────────────────────────────────────────
  renderer.on('resize', () => {
    sidePanel.visible = renderer.width >= 100
    updateStatus()
  })

  // ── Initial render ──────────────────────────────────────────────────────
  refreshPlans()
  updateStatus()

  // Keep alive
  await new Promise<void>(() => {})
}
