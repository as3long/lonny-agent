import { formatToolInput, Session, type SessionOutput } from '../agent/session.js'
import type { Config } from '../config/index.js'
import type { OverlayHandle, SlashCommand } from '../pi-tui/index.js'
import {
  Box,
  CombinedAutocompleteProvider,
  Editor,
  Loader,
  Markdown,
  ProcessTerminal,
  TUI,
} from '../pi-tui/index.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from './balance.js'
import { handleConfirmInput, sendMessage } from './commands.js'
import {
  colors,
  LandingScreen,
  listPlans,
  PlansList,
  RichFooter,
  TodoPanel,
} from './components/index.js'
import type { TuiContext } from './overlays.js'
import {
  refreshPlans,
  showHelpOverlay,
  showPlanDetail,
  showPlansOverlay,
  showTodoPanel,
  updateFooter,
} from './overlays.js'
import { editorTheme, markdownTheme, selectTheme } from './themes.js'

class Spacer {
  constructor(private height: number) {}
  render(_width: number): string[] {
    return Array.from({ length: this.height }, () => '')
  }
  invalidate(): void {}
}

export async function startTui(config: Config, preloadedSession?: Session): Promise<void> {
  const ctx = {} as TuiContext

  // ── Create terminal and TUI ────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  const origWrite = terminal.write.bind(terminal)
  terminal.write = (data: string) => {
    const filtered = data.replace(/\x1b\[\?1049[hl]/g, '')
    if (filtered) origWrite(filtered)
  }
  const tui = new TUI(terminal, true)
  tui.setClearOnShrink(true)
  terminal.setTitle(`lonny ${config.model} ${config.provider}`)
  ctx.tui = tui

  // ── Create components ──────────────────────────────────────────────────
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  ctx.chatMarkdown = chatMarkdown
  const chatBox = new Box(1, 0)
  chatBox.addChild(chatMarkdown)
  chatBox.addChild(new Spacer(13))

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
    { name: 'sessions', description: 'List all saved sessions' },
    {
      name: 'session',
      description: 'Show current session info',
      argumentHint: '[title <name>|delete]',
    },
    { name: 'fork', description: 'Fork a new session from current context' },
    { name: 'new', description: 'Start a new session' },
    { name: 'init', description: 'Create .lonny/skills/ & prompts/' },
    { name: 'help', description: 'Show help' },
    { name: 'stop', description: 'Stop the running agent' },
    { name: 'exit', description: 'Exit' },
    { name: 'filter', description: 'Filter plans', argumentHint: '<query>' },
  ]
  const editor = new Editor(tui, editorTheme)
  ctx.editor = editor
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands, config.cwd))

  const loader = new Loader(tui, colors.running, colors.idle, 'thinking...', { intervalMs: 80 })
  ctx.loader = loader

  let inputOverlayHandle: OverlayHandle | null = null

  const footer = new RichFooter(config.cwd, config.model, config.provider)
  ctx.footer = footer

  // ── Init mutable state ─────────────────────────────────────────────────
  ctx.chatContent = ''
  ctx.isRunning = false
  ctx.pendingConfirmResolve = null
  ctx.plansOverlayHandle = null
  ctx.helpOverlayHandle = null
  ctx.todoPanelHandle = null
  ctx.plansDetailMode = false
  ctx.config = config

  // ── Plan written callback ──────────────────────────────────────────────
  const planCb = () => {
    refreshPlans(ctx)
    ctx.todoPanel.refresh()
    if (ctx.plansOverlayHandle?.isHidden() === false) {
      showPlansOverlay(ctx)
    }
  }
  ctx.planCb = planCb

  // ── Session output ─────────────────────────────────────────────────────
  const output: SessionOutput = {
    write: (text: string) => {
      ctx.chatContent += text
      ctx.chatMarkdown.setText(ctx.chatContent)
    },
    suppressToolOutput: false,
    confirmTool: async toolCalls => {
      ctx.chatContent += `\n  ${colors.warn('Allow these tool calls?')}\n`
      for (const tc of toolCalls) {
        const detail = formatToolInput(tc)
        ctx.chatContent += `  ${colors.dim('\u2022')} ${colors.accent(tc.name)}${detail ? ` ${colors.dim(detail)}` : ''}\n`
      }
      ctx.chatContent += `  ${colors.inputPrompt('(y/N)')} `
      ctx.chatMarkdown.setText(ctx.chatContent)
      ctx.tui.requestRender(true)

      return new Promise(resolve => {
        ctx.pendingConfirmResolve = resolve
      })
    },
  }
  ctx.output = output

  // ── Session restore ────────────────────────────────────────────────────
  let restored = false
  let restoredSession: Session | null = preloadedSession ?? null
  if (!restoredSession) {
    restoredSession = await Session.load(config, output)
  }
  if (restoredSession) {
    restored = true
    ctx.session = restoredSession
    ctx.session.onPlanWritten = planCb
    const lastUserMsg = [...ctx.session.messages].reverse().find(m => m.role === 'user')
    const lastQuestion =
      lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content : null
    ctx.chatContent = `\n${colors.dim('\u21BA Resumed previous session')}`
    if (lastQuestion) {
      const preview = lastQuestion.length > 80 ? `${lastQuestion.slice(0, 80)}\u2026` : lastQuestion
      ctx.chatContent += ` \u2014 ${colors.userLabel(preview)}`
    }
    ctx.chatContent += '\n\n'
    ctx.chatMarkdown.setText(ctx.chatContent)
  } else {
    ctx.session = new Session(config, output)
    ctx.session.onPlanWritten = planCb
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
          ctx.chatContent += `\n${colors.warn('\u26A0')} Balance fetch failed: ${balance.error}\n`
          ctx.chatMarkdown.setText(ctx.chatContent)
        }
      }
    } catch {
      // Silently ignore balance fetch errors
    }
  })()

  // ── Landing screen ────────────────────────────────────────────────────
  const landingScreen = new LandingScreen(config.model, config.provider)
  let landingOverlayHandle: OverlayHandle | null = null
  if (!restored) {
    landingOverlayHandle = tui.showOverlay(landingScreen, {
      anchor: 'center',
      width: 70,
      maxHeight: 14,
    })
    tui.setFocus(landingScreen)
  }

  // ── Rich footer bar ────────────────────────────────────────────────────
  const footerWidth = terminal.columns ?? process.stdout.columns ?? 120
  const footerHandle = tui.showOverlay(footer, {
    anchor: 'bottom-left',
    width: footerWidth,
    nonCapturing: true,
  })

  // ── Persistent Todo Side Panel ────────────────────────────────────────
  const todoPanel = new TodoPanel(config.cwd)
  ctx.todoPanel = todoPanel

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
    showTodoPanel(ctx)
    tui.setFocus(editor)
  }

  // ── Plans overlay components ──────────────────────────────────────────
  const plansList = new PlansList([], 15, selectTheme)
  ctx.plansList = plansList

  // ── Wire up submit on editor ─────────────────────────────────────────-
  editor.onSubmit = (value: string) => {
    sendMessage(ctx, value)
  }

  // ── Landing screen transition ──────────────────────────────────────────
  landingScreen.onSubmit = () => {
    if (ctx.isRunning) return

    if (landingOverlayHandle) landingOverlayHandle.hide()
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

    showTodoPanel(ctx)

    tui.setFocus(editor)
    tui.requestRender(true)
  }

  // ── Input listener ──────────────────────────────────────────────────────
  tui.addInputListener(data => {
    if (ctx.pendingConfirmResolve) {
      return { consume: handleConfirmInput(ctx, data) }
    }

    if (ctx.helpOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[' || data === '?') {
        ctx.helpOverlayHandle.hide()
        ctx.helpOverlayHandle = null
      }
      return { consume: true }
    }

    if (ctx.plansOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[') {
        if (ctx.plansDetailMode) {
          ctx.plansOverlayHandle.hide()
          ctx.plansOverlayHandle = null
          ctx.plansDetailMode = false
          showPlansOverlay(ctx)
        } else {
          ctx.plansOverlayHandle.hide()
          ctx.plansOverlayHandle = null
        }
        return { consume: true }
      }
      if (data === '\r' && !ctx.plansDetailMode) {
        showPlanDetail(ctx)
        return { consume: true }
      }
      if (data === '\x1b[A') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = ctx.plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx <= 0 ? plans.length - 1 : idx - 1
          ctx.plansList.setSelectedIndex(nextIdx)
          updateFooter(ctx)
        }
        return { consume: true }
      }
      if (data === '\x1b[B') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = ctx.plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx === -1 ? 0 : (idx + 1) % plans.length
          ctx.plansList.setSelectedIndex(nextIdx)
          updateFooter(ctx)
        }
        return { consume: true }
      }
      return { consume: true }
    }

    if (data === '?') {
      showHelpOverlay(ctx)
      return { consume: true }
    }

    return undefined
  })

  // ── Initial render ────────────────────────────────────────────────────
  loader.setMessage('')
  refreshPlans(ctx)

  if (!restored) {
    ctx.chatMarkdown.setText('')
  }

  tui.start()

  await new Promise<void>(() => {})
}
