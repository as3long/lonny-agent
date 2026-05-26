import * as blessed from 'blessed'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { PlansPanel } from './plans-panel.js'
import { TodosPanel } from './todo-panel.js'
import { setOnPlanWritten } from '../tools/write_plan.js'

export async function startTui(config: Config): Promise<void> {
  // Create blessed screen
  const screen = blessed.screen({
    smartCSR: true,
    title: 'lonny',
    dockBorders: true,
    autoPadding: true,
  })

  // --- Layout ---
  // Main vertical layout: top (chat + right panels) + bottom (input)

  // Chat panel (left 70%)
  const chatBox = blessed.box({
    top: 0,
    left: 0,
    width: '70%',
    height: '100%-3',
    label: ' Chat ',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    tags: true,
    style: { fg: 'white', bg: 'black' },
    content: '',
  })

  // Right panel container (30%)
  const rightBox = blessed.box({
    top: 0,
    left: '70%',
    width: '30%',
    height: '100%-3',
  })

  // Plans panel (right top, 50% of right panel)
  const plansBox = blessed.list({
    parent: rightBox,
    top: 0,
    left: 0,
    width: '100%',
    height: '50%',
    label: ' Plans ',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
      selected: { fg: 'black', bg: 'blue' },
    },
    items: ['{bold}No plans yet{/bold}'],
    keys: true,
    vi: true,
  })

  // Todos panel (right bottom, 50% of right panel)
  const todosBox = blessed.list({
    parent: rightBox,
    top: '50%',
    left: 0,
    width: '100%',
    height: '50%',
    label: ' Todos ',
    border: { type: 'line' },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
      selected: { fg: 'black', bg: 'blue' },
    },
    items: ['{bold}Select a plan to view todos{/bold}'],
  })

  // Input bar (bottom 3 lines)
  const inputBox = blessed.textbox({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    label: ' Input ',
    border: { type: 'line' },
    style: { fg: 'white', bg: 'black' },
    inputOnFocus: true,
  })

  // --- Initialize panels ---
  const plansPanel = new PlansPanel(config.cwd)
  const todosPanel = new TodosPanel()

  // Wire up plan selection
  plansPanel.onSelect((filePath: string) => {
    todosPanel.loadPlan(filePath)
    refreshTodosDisplay()
  })

  // Keyboard navigation for plans list
  plansBox.on('select', (_item: any, index: number) => {
    plansPanel.setSelectedIndex(index)
    plansPanel.selectCurrent()
    refreshPlansDisplay()
  })

  // Key bindings
  screen.key(['C-c'], () => {
    screen.destroy()
    process.exit(0)
  })

  screen.key(['tab'], () => {
    if (screen.focused === inputBox) {
      plansBox.focus()
    } else {
      inputBox.focus()
    }
    screen.render()
  })

  // --- Output capture for chat box ---
  let chatContent = ''

  function appendToChat(text: string): void {
    chatContent += text
    chatBox.setContent(chatContent)
    chatBox.setScrollPerc(100) // scroll to bottom
    screen.render()
  }

  // Create session output handler
  const sessionOutput: SessionOutput = {
    write: (text: string) => appendToChat(text),
    error: (...args: any[]) => appendToChat(args.map(a => String(a)).join(' ') + '\n'),
  }

  // --- Refresh display functions ---
  function refreshPlansDisplay(): void {
    const plans = plansPanel.getFormattedItems()
    plansBox.setItems(plans)
    plansBox.select(plansPanel.getSelectedIndex())
    screen.render()
  }

  function refreshTodosDisplay(): void {
    const items = todosPanel.getFormattedItems()
    todosBox.setItems(items)
    screen.render()
  }

  function refreshAll(): void {
    plansPanel.scan()
    refreshPlansDisplay()
    refreshTodosDisplay()
  }

  // Wire up the onPlanWritten callback to auto-refresh
  setOnPlanWritten((_filePath: string) => {
    refreshAll()
  })

  // --- Session setup ---
  const session = new Session(config, sessionOutput)

  // --- Event loop ---
  inputBox.on('submit', async (data: any) => {
    const input = typeof data === 'string' ? data : (data || '')
    const trimmed = input.trim()
    inputBox.clearValue()

    if (!trimmed) {
      screen.render()
      return
    }

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const arg = parts.slice(1).join(' ')

      if (cmd === 'exit' || cmd === 'quit') {
        appendToChat('  Goodbye!\n')
        screen.destroy()
        process.exit(0)
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          appendToChat(`  * Switched to ${arg} mode\n`)
        } else {
          appendToChat(`  * Usage: /mode code|plan  (current: ${session.config.mode})\n`)
        }
        screen.render()
        return
      }

      if (cmd === 'refresh') {
        refreshAll()
        screen.render()
        return
      }

      appendToChat(`  * Unknown command: /${cmd}\n`)
      screen.render()
      return
    }

    // Send to session — output is captured via sessionOutput
    try {
      await session.chat(trimmed)
      appendToChat('\n')
    } catch (err) {
      appendToChat(`  x ${err instanceof Error ? err.message : String(err)}\n`)
    }

    // Refresh plans after chat (agent may have written a plan)
    refreshAll()
  })

  // Initial render
  refreshAll()
  inputBox.focus()
  screen.render()
}
