import * as fs from 'node:fs'
import * as path from 'node:path'
import { resetGlobalEventBus } from '../agent/event-bus.js'
import { ensurePromptsDir, loadPromptTemplates } from '../agent/prompt-templates.js'
import { formatToolInput, Session, type SessionOutput } from '../agent/session.js'
import { ensureSkillsDir, loadSkills } from '../agent/skills.js'
import type { Config } from '../config/index.js'
import { loadTokenUsage, resetTokenUsage } from '../config/tokens.js'
import type {
  EditorTheme,
  MarkdownTheme,
  OverlayHandle,
  SelectItem,
  SelectListTheme,
  SlashCommand,
} from '../pi-tui/index.js'
import {
  Box,
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  Text,
  TUI,
} from '../pi-tui/index.js'
import { fmtErr } from '../tools/errors.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from './balance.js'
import {
  colors,
  LandingScreen,
  listPlans,
  loadTodos,
  PlansList,
  plansToItems,
  RichFooter,
  TodoPanel,
} from './components.js'
import { highlightLine } from './highlight.js'

/**
 * Invisible spacer that renders N empty lines.
 * Used to reserve space at the bottom of the chat area so the editor
 * overlay doesn't cover the last lines of command output.
 */
class Spacer {
  constructor(private height: number) {}
  render(_width: number): string[] {
    return Array.from({ length: this.height }, () => '')
  }
  invalidate(): void {}
}

export async function startTui(config: Config): Promise<void> {
  let chatContent = ''
  let isRunning = false
  let session: Session

  // ── Create markdown theme (OpenCode-style, clean colors, with syntax highlighting) ──
  const markdownTheme: MarkdownTheme = {
    heading: t => `\x1b[38;2;0;170;255m\x1b[1m${t}\x1b[0m`,
    link: t => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
    linkUrl: t => `\x1b[38;2;90;90;90m\x1b[4m${t}\x1b[0m`,
    code: t => `\x1b[38;2;255;180;50m${t}\x1b[0m`,
    codeBlock: t => `\x1b[38;2;200;200;200m${t}\x1b[0m`,
    codeBlockBorder: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    highlightCode: (code: string, lang?: string) => {
      if (lang && lang.trim()) {
        const lines = code.split('\n')
        return lines.map(line => highlightLine(line, lang))
      }
      return code.split('\n')
    },
    codeBlockIndent: '  ',
    quote: t => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    quoteBorder: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    hr: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    listBullet: t => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    bold: t => `\x1b[1m${t}\x1b[0m`,
    italic: t => `\x1b[3m${t}\x1b[0m`,
    strikethrough: t => `\x1b[9m${t}\x1b[0m`,
    underline: t => `\x1b[4m${t}\x1b[0m`,
  }

  // ── Create select list theme ──
  const selectTheme: SelectListTheme = {
    selectedPrefix: t => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m ${t}\x1b[0m`,
    selectedText: t => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m${t}\x1b[0m`,
    description: t => `\x1b[90m${t}\x1b[0m`,
    scrollInfo: t => `\x1b[90m${t}\x1b[0m`,
    noMatch: t => `\x1b[38;2;255;100;100m${t}\x1b[0m`,
  }

  // ── Create editor theme (used by Editor component) ────────────────────
  const editorTheme: EditorTheme = {
    borderColor: (str: string) => colors.accent(str),
    selectList: selectTheme,
  }

  // ── Create terminal and TUI ────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  // Patch terminal.write to suppress alternate screen buffer sequences.
  // Without this, pi-tui disables the terminal's native scrollback/scrollbar,
  // making it impossible to scroll through past conversation history.
  const origWrite = terminal.write.bind(terminal)
  terminal.write = (data: string) => {
    const filtered = data.replace(/\x1b\[\?1049[hl]/g, '')
    if (filtered) origWrite(filtered)
  }
  // Show hardware cursor by default so IME (Chinese input method) can
  // position its candidate window at the correct cursor location.
  // The cursor is hidden during agent execution via setShowHardwareCursor(false).
  // Note: on some terminals (Windows Terminal), showing the hardware cursor
  // can interfere with editor rendering layout. If you see editor border gap,
  // set this to false and use PI_HARDWARE_CURSOR=1 env var to enable.
  const tui = new TUI(terminal, true)
  tui.setClearOnShrink(true)
  terminal.setTitle(`lonny ${config.model} ${config.provider}`)

  // ── Create components ──────────────────────────────────────────────────

  // Chat area (full width, no side panel) — created upfront but only added
  // to the TUI after the landing screen transitions to chat mode.
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  const chatBox = new Box(1, 0)
  chatBox.addChild(chatMarkdown)
  // Reserve space at the bottom so the editor overlay doesn't cover
  // the last lines of command output. 13 = maxHeight(12) + offsetY(1).
  chatBox.addChild(new Spacer(13))

  // Chat input — Editor with multi-line support, history, and autocomplete
  const slashCommands: SlashCommand[] = [
    {
      name: 'mode',
      description: 'Switch mode (code|plan|ask|loop)',
      argumentHint: 'code|plan|ask|loop',
    },
    { name: 'model', description: 'Switch model', argumentHint: '<name>' },
    { name: 'plans', description: 'Show plans overlay' },
    { name: 'prompts', description: 'List prompt templates' },
    { name: 'skills', description: 'List active skills' },
    { name: 'new', description: 'Start a new session' },
    { name: 'init', description: 'Create .lonny/skills/ & prompts/' },
    { name: 'help', description: 'Show help' },
    { name: 'stop', description: 'Stop the running agent' },
    { name: 'exit', description: 'Exit' },
    { name: 'filter', description: 'Filter plans', argumentHint: '<query>' },
  ]
  const editor = new Editor(tui, editorTheme)
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands, config.cwd))

  // Loader (thinking indicator)
  const loader = new Loader(tui, colors.running, colors.idle, 'thinking...', { intervalMs: 80 })

  // Input area — the editor is shown as a bottom-anchored overlay so the
  // input always stays at the bottom of the terminal, regardless of how
  // much chat content has accumulated.
  let inputOverlayHandle: OverlayHandle | null = null

  // Rich footer (cwd | mode | tokens | model | version + command hints)
  const footer = new RichFooter(config.cwd, config.model, config.provider)

  // ── Build layout (landing phase) ──
  // In the landing phase, only the footer is shown. The chatBox, editor,
  // and loader are added after the first message (see landingScreen.onSubmit).
  //
  // The editor and loader are shown as a bottom-anchored overlay so the
  // input area always stays at the bottom of the terminal, regardless of
  // how much chat content has accumulated.

  // ── Plan written callback (defined early since it's used by session restore) ──
  const planCb = () => {
    refreshPlans()
    todoPanel.refresh()
    if (plansOverlayHandle?.isHidden() === false) {
      showPlansOverlay()
    }
  }

  // ── Session output ────────────────────────────────────────────────────
  // Tool call/result text flows through output.write naturally, interspersed
  // with assistant text in the correct order (just like non-TUI mode).
  // ── Tool confirmation state ──
  let pendingConfirmResolve: ((approved: boolean) => void) | null = null

  function handleConfirmInput(data: string): boolean {
    if (!pendingConfirmResolve) return false
    const key = data.trim().toLowerCase()
    if (key === 'y' || key === 'yes') {
      pendingConfirmResolve(true)
      pendingConfirmResolve = null
      chatContent += 'y\n'
      chatMarkdown.setText(chatContent)
      tui.requestRender(true)
      return true
    } else if (key === 'n' || key === 'no' || key === '\r' || key === '') {
      pendingConfirmResolve(false)
      pendingConfirmResolve = null
      chatContent += 'N\n'
      chatMarkdown.setText(chatContent)
      tui.requestRender(true)
      return true
    }
    return false
  }

  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.setText(chatContent)
    },
    suppressToolOutput: false,
    confirmTool: async toolCalls => {
      chatContent += `\n  ${colors.warn('Allow these tool calls?')}\n`
      for (const tc of toolCalls) {
        const detail = formatToolInput(tc)
        chatContent += `  ${colors.dim('\u2022')} ${colors.accent(tc.name)}${detail ? ` ${colors.dim(detail)}` : ''}\n`
      }
      chatContent += `  ${colors.inputPrompt('(y/N)')} `
      chatMarkdown.setText(chatContent)
      tui.requestRender(true)

      return new Promise(resolve => {
        pendingConfirmResolve = resolve
      })
    },
  }

  // Try to restore a saved session for this directory (MUST be before landing screen setup)
  let restored = false
  const restoredSession = await Session.load(config, output)
  if (restoredSession) {
    restored = true
    session = restoredSession
    session.onPlanWritten = planCb
    // Find the last user message from the previous session
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    const lastQuestion =
      lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : null
    chatContent = `\n${colors.dim('\u21BA Resumed previous session')}`
    if (lastQuestion) {
      const preview = lastQuestion.length > 80 ? `${lastQuestion.slice(0, 80)}\u2026` : lastQuestion
      chatContent += ` \u2014 ${colors.userLabel(preview)}`
    }
    chatContent += '\n\n'
    chatMarkdown.setText(chatContent)
  } else {
    session = new Session(config, output)
    session.onPlanWritten = planCb
  }
  // ── Fetch DeepSeek balance at startup (non-blocking)
  ;(async () => {
    try {
      if (isDeepSeekOfficial(config.baseUrl) && config.apiKey) {
        const balance = await fetchDeepSeekBalance(config.apiKey)
        if (balance.isAvailable && balance.display) {
          footer.setBalance(balance.display)
          footer.setWebBalance(balance.webDisplay)
          tui.requestRender(true)
        } else if (balance.error) {
          chatContent += `\n${colors.warn('\u26A0')} Balance fetch failed: ${balance.error}\n`
          chatMarkdown.setText(chatContent)
        }
      }
    } catch {
      // Silently ignore balance fetch errors
    }
  })()

  // ── Landing screen (centered overlay with pixel logo) ────────────────
  const landingScreen = new LandingScreen(config.model, config.provider)
  let landingOverlayHandle: OverlayHandle | null = null
  // Only show the landing screen if no session was restored
  if (!restored) {
    landingOverlayHandle = tui.showOverlay(landingScreen, {
      anchor: 'center',
      width: 70,
      maxHeight: 14,
    })
    tui.setFocus(landingScreen)
  }

  // ── Rich footer bar ──────────────────────────────────
  // NOTE: must be added AFTER the landing screen overlay so it renders on
  // top and is not covered by the centered overlay.
  const footerWidth = terminal.columns ?? process.stdout.columns ?? 120
  const footerHandle = tui.showOverlay(footer, {
    anchor: 'bottom-left',
    width: footerWidth,
    nonCapturing: true,
  })

  // ── Persistent Todo Side Panel ────────────────────────────────────────
  const todoPanel = new TodoPanel(config.cwd)
  let todoPanelHandle: OverlayHandle | null = null

  function showTodoPanel(): void {
    todoPanel.refresh()
    const box = new Box(0, 0, colors.bgDark)
    box.addChild(todoPanel)
    todoPanelHandle = tui.showOverlay(box, {
      anchor: 'top-right',
      offsetY: 2,
      width: 36,
      maxHeight: '70%',
      offsetX: -1,
      nonCapturing: true,
      visible: (w: number) => w >= 110,
    })
  }

  // If a session was restored, immediately transition to chat layout
  // (skip the landing screen)
  if (restored) {
    footer.setPhase('chat')
    tui.addChild(chatBox)
    tui.addChild(loader)
    inputOverlayHandle = tui.showOverlay(editor, {
      anchor: 'bottom-left',
      width: terminal.columns ?? process.stdout.columns ?? 120,
      offsetY: -1,
      maxHeight: 12,
      nonCapturing: false,
    })
    showTodoPanel()
    tui.setFocus(editor)
  }

  // ── Plans overlay components ──────────────────────────────────────────
  const plansList = new PlansList([], 15, selectTheme)
  let plansOverlayHandle: OverlayHandle | null = null
  let plansDetailMode = false

  function showPlansOverlay(): void {
    if (plansOverlayHandle?.isHidden() === false) {
      plansOverlayHandle.hide()
      plansOverlayHandle = null
      plansDetailMode = false
      return
    }
    plansDetailMode = false
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))

    const headerText = new Text(
      ` ${colors.accent('\u25B6')} Plans (${plans.length})  ${colors.dim('Enter=view')}`,
      1,
      0,
      colors.headerBg,
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

  function showPlanDetail(): void {
    if (!plansOverlayHandle || plansOverlayHandle.isHidden()) return
    const sel = plansList.getSelectedItem()
    if (!sel) return

    plansDetailMode = true
    const plans = listPlans(config.cwd)
    const plan = plans.find(p => p.name === sel.value)
    if (!plan) return

    const todos = loadTodos(plan.fullPath)
    const headerText = new Text(
      ` ${colors.accent('\u25B6')} ${colors.warn(plan.name)}  ${colors.dim('Esc=back')}`,
      1,
      0,
      colors.headerBg,
    )
    const todosText = new Text(`\n  ${todos}\n`, 1, 0)
    const container = new Container()
    container.addChild(headerText)
    container.addChild(todosText)

    const box = new Box(1, 1, colors.bgDark)
    box.addChild(container)

    // Hide current and show detail
    plansOverlayHandle.hide()
    plansOverlayHandle = tui.showOverlay(box, {
      anchor: 'right-center',
      width: 50,
      maxHeight: '80%',
      offsetX: -1,
    })
  }

  // ── Help overlay ──────────────────────────────────────────────────────────
  let helpOverlayHandle: OverlayHandle | null = null

  function showHelpOverlay(): void {
    if (helpOverlayHandle?.isHidden() === false) {
      helpOverlayHandle.hide()
      helpOverlayHandle = null
      return
    }
    const helpContent =
      colors.accent('\u2501').repeat(20) +
      '\n' +
      ` ${colors.accent('lonny')} ${colors.dim('TUI Help')}\n` +
      colors.accent('\u2501').repeat(20) +
      '\n\n' +
      ` ${colors.dim('Commands:')}\n` +
      ` ${colors.inputPrompt('/mode')} code|plan|ask|loop  ${colors.dim('Switch mode')}\n` +
      `   ${colors.inputPrompt('/model')} <name>    ${colors.dim('Switch model')}\n` +
      `   ${colors.inputPrompt('/plans')}          ${colors.dim('Show plans overlay')}\n` +
      `   ${colors.inputPrompt('/new')}            ${colors.dim('Start a new session')}\n` +
      `   ${colors.inputPrompt('/prompts')}        ${colors.dim('List prompt templates')}\n` +
      `   ${colors.inputPrompt('/skills')}         ${colors.dim('List active skills')}\n` +
      `   ${colors.inputPrompt('/init')}           ${colors.dim('Create .lonny/skills/ & prompts/')}\n` +
      `   ${colors.inputPrompt('/stop')}           ${colors.dim('Stop the running agent')}\n` +
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
  function updateFooter(): void {
    const plans = listPlans(config.cwd)
    footer.setAgentStatus(isRunning ? 'running' : 'idle')
    footer.setMode(
      session?.config.mode === 'plan'
        ? 'plan'
        : session?.config.mode === 'ask'
          ? 'ask'
          : session?.config.mode === 'loop'
            ? 'loop'
            : 'code',
    )
    footer.setModel(config.model, config.provider)
    const tokenStats = loadTokenUsage(config.cwd)
    footer.setTokenUsage(
      tokenStats.totalInputTokens,
      tokenStats.totalOutputTokens,
      tokenStats.totalApiCalls,
    )
    tui.requestRender(true)
  }

  function refreshPlans(): void {
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))
    todoPanel.refresh()
    updateFooter()
  }

  async function refreshBalance(): Promise<void> {
    try {
      if (isDeepSeekOfficial(config.baseUrl) && config.apiKey) {
        const balance = await fetchDeepSeekBalance(config.apiKey)
        if (balance.isAvailable && balance.display) {
          footer.setBalance(balance.display)
          footer.setWebBalance(balance.webDisplay)
        } else {
          footer.setBalance('')
          footer.setWebBalance('')
        }
        tui.requestRender(true)
      }
    } catch {
      // Silently ignore
    }
  }

  // ── Input handling ──────────────────────────────────────────────────────
  async function sendMessage(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    editor.setText('')
    editor.addToHistory(trimmed)

    // Allow slash commands even when agent is running (critical for /stop)
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
        // If the agent is running, stop the old session gracefully first.
        // Without this, the pending chat() promise would continue consuming
        // tokens and write stale output into the freshly cleared chat display.
        if (isRunning) {
          session.stop()
          isRunning = false
          loader.setMessage('')
          tui.setShowHardwareCursor(true)
        }
        Session.clearSavedSession(config.cwd)
        resetTokenUsage(config.cwd)
        resetGlobalEventBus()
        session = new Session(config, output)
        session.onPlanWritten = planCb
        chatContent = ''
        chatMarkdown.setText('')
        plansList.clearFilter()
        // Reset editor internal state that setText('') doesn't clear
        ;(editor as any).undoStack.clear()
        ;(editor as any).history = []
        ;(editor as any).killRing.ring = []
        updateFooter()
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan' || arg === 'ask' || arg === 'loop') {
          await session.setMode(arg)
          const modeColor =
            arg === 'ask'
              ? colors.success(arg)
              : arg === 'loop'
                ? colors.accent(arg)
                : colors.warn(arg)
          chatContent += `\n${colors.warn('\u21E8')} Switched to ${modeColor} mode\n`
          chatMarkdown.setText(chatContent)
          updateFooter()
        } else {
          chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/mode code|plan|ask|loop')}  (current: ${session.config.mode})\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      if (cmd === 'model') {
        if (arg) {
          session.config.model = arg
          // Rebuild system prompt with new model context
          await session.setMode(session.config.mode) // triggers rebuild
          chatContent += `\n${colors.warn('\u21E8')} Model switched to ${colors.warn(arg)}\n`
          chatMarkdown.setText(chatContent)
          updateFooter()
        } else {
          chatContent += `\n${colors.inputPrompt('Current model:')} ${colors.dim(session.config.model)}\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      if (cmd === 'prompts') {
        const templates = loadPromptTemplates(config.cwd)
        if (templates.length === 0) {
          chatContent += `\n${colors.warn('No prompt templates found.')} ${colors.dim('Create .md files in .lonny/prompts/')}\n`
        } else {
          chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Prompt Templates (${templates.length})`)}\n`
          for (const t of templates) {
            chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(t.name)}`
            if (t.description) chatContent += ` ${colors.dim(`\u2014 ${t.description}`)}`
            chatContent += '\n'
          }
        }
        chatMarkdown.setText(chatContent)
        return
      }

      if (cmd === 'skills') {
        const skills = loadSkills(config.cwd)
        if (skills.length === 0) {
          chatContent += `\n${colors.warn('No skills loaded.')} ${colors.dim('Create .md files in .lonny/skills/')}\n`
        } else {
          chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Active Skills (${skills.length})`)}\n`
          for (const s of skills) {
            chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(s.name)}`
            if (s.description) chatContent += ` ${colors.dim(`\u2014 ${s.description}`)}`
            chatContent += '\n'
          }
        }
        chatMarkdown.setText(chatContent)
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

      if (cmd === 'init') {
        ensureSkillsDir(config.cwd)
        ensurePromptsDir(config.cwd)
        chatContent += `\n${colors.success('\u2714')} Initialized .lonny/skills/ and .lonny/prompts/\n`
        chatMarkdown.setText(chatContent)
        return
      }

      if (cmd === 'stop') {
        if (!isRunning) {
          chatContent += `\n${colors.dim('Agent is not running.')}\n`
          chatMarkdown.setText(chatContent)
          return
        }
        // Tell the session to stop gracefully
        session.stop()
        chatContent += `\n${colors.warn('\u23F9')} Stopping agent...\n`
        chatMarkdown.setText(chatContent)
        isRunning = false
        loader.stop()
        loader.setMessage('')
        tui.setShowHardwareCursor(true)
        updateFooter()
        return
      }

      chatContent += `\n${colors.error('\u2716')} Unknown command: /${cmd}. ${colors.dim('Type /help for available commands.')}\n`
      chatMarkdown.setText(chatContent)
      return
    }

    // Block regular messages when agent is already running
    if (isRunning) return

    isRunning = true
    loader.setMessage('thinking...')
    tui.setShowHardwareCursor(false)
    updateFooter()

    session
      .chat(trimmed)
      .then(() => {
        isRunning = false
        loader.setMessage('')
        refreshPlans()
        tui.setShowHardwareCursor(true)
        updateFooter()
        refreshBalance()
      })
      .catch((err: unknown) => {
        isRunning = false
        loader.setMessage('')
        const errMsg = fmtErr(err)
        chatContent += `\n${colors.error('\u2716 Error:')} ${errMsg}\n`
        chatMarkdown.setText(chatContent)
        tui.setShowHardwareCursor(true)
        updateFooter()
      })
  }

  // Wire up submit on editor (after landing transition)
  editor.onSubmit = (value: string) => {
    sendMessage(value)
  }

  // ── Landing screen transition ────────────────────────────────────────────
  // When the user presses any key on the landing screen, transition to the
  // full chat layout (editor + chat area).
  landingScreen.onSubmit = () => {
    if (isRunning) return

    // Hide the landing overlay
    if (landingOverlayHandle) landingOverlayHandle.hide()
    footer.setPhase('chat')

    // Add chat components to the main TUI
    // (footer is already an overlay anchored to bottom-left, no need to addChild)
    tui.addChild(chatBox)
    tui.addChild(loader)
    inputOverlayHandle = tui.showOverlay(editor, {
      anchor: 'bottom-left',
      width: terminal.columns ?? process.stdout.columns ?? 120,
      offsetY: -1,
      maxHeight: 12,
      nonCapturing: false,
    })

    showTodoPanel()

    // Focus the chat editor
    tui.setFocus(editor)
    tui.requestRender(true)
  }

  // ── Input listener ──────────────────────────────────────────────────────
  tui.addInputListener(data => {
    // Check if tool confirmation is pending (consume all input until resolved)
    if (pendingConfirmResolve) {
      return { consume: handleConfirmInput(data) }
    }

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
      if (data === '\x1b' || data === '\x1b[') {
        if (plansDetailMode) {
          // Go back to plan list
          plansOverlayHandle.hide()
          plansOverlayHandle = null
          plansDetailMode = false
          showPlansOverlay()
        } else {
          plansOverlayHandle.hide()
          plansOverlayHandle = null
        }
        return { consume: true }
      }
      if (data === '\r' && !plansDetailMode) {
        // Enter: view plan detail
        showPlanDetail()
        return { consume: true }
      }
      if (data === '\x1b[A') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx <= 0 ? plans.length - 1 : idx - 1
          plansList.setSelectedIndex(nextIdx)
          updateFooter()
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
          updateFooter()
        }
        return { consume: true }
      }
      return { consume: true }
    }

    if (data === '?') {
      showHelpOverlay()
      return { consume: true }
    }

    return undefined
  })

  // ── Initial render ────────────────────────────────────────────────────
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
