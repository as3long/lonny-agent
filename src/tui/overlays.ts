import { loadTokenUsage } from '../config/tokens.js'
import { Box, Container, Text } from '../pi-tui/index.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from './balance.js'
import { colors, listPlans, loadTodos, plansToItems } from './components/index.js'

export interface TuiContext {
  tui: any
  editor: any
  loader: any
  footer: any
  chatMarkdown: any
  plansList: any
  todoPanel: any
  session: any
  config: any
  output: any

  chatContent: string
  isRunning: boolean
  pendingConfirmResolve: ((approved: boolean) => void) | null

  plansOverlayHandle: any
  helpOverlayHandle: any
  todoPanelHandle: any

  plansDetailMode: boolean

  planCb: () => void
}

export function showTodoPanel(ctx: TuiContext): void {
  ctx.todoPanel.refresh()
  const box = new Box(0, 0, colors.bgDark)
  box.addChild(ctx.todoPanel)
  ctx.todoPanelHandle = ctx.tui.showOverlay(box, {
    anchor: 'top-right',
    offsetY: 2,
    width: 36,
    maxHeight: '70%',
    offsetX: -1,
    nonCapturing: true,
    visible: (w: number) => w >= 110,
  })
}

export function showPlansOverlay(ctx: TuiContext): void {
  if (ctx.plansOverlayHandle?.isHidden() === false) {
    ctx.plansOverlayHandle.hide()
    ctx.plansOverlayHandle = null
    ctx.plansDetailMode = false
    return
  }
  ctx.plansDetailMode = false
  const plans = listPlans(ctx.config.cwd)
  ctx.plansList.refresh(plansToItems(plans))

  const headerText = new Text(
    ` ${colors.accent('\u25B6')} Plans (${plans.length})  ${colors.dim('Enter=view')}`,
    1,
    0,
    colors.headerBg,
  )
  const container = new Container()
  container.addChild(headerText)
  if (plans.length > 0) {
    container.addChild(ctx.plansList)
  } else {
    container.addChild(new Text('  (no plans yet)', 1, 0, colors.dim))
  }

  const box = new Box(1, 1, colors.bgDark)
  box.addChild(container)

  ctx.plansOverlayHandle = ctx.tui.showOverlay(box, {
    anchor: 'right-center',
    width: 45,
    maxHeight: '70%',
    offsetX: -1,
  })
}

export function showPlanDetail(ctx: TuiContext): void {
  if (!ctx.plansOverlayHandle || ctx.plansOverlayHandle.isHidden()) return
  const sel = ctx.plansList.getSelectedItem()
  if (!sel) return

  ctx.plansDetailMode = true
  const plans = listPlans(ctx.config.cwd)
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

  ctx.plansOverlayHandle.hide()
  ctx.plansOverlayHandle = ctx.tui.showOverlay(box, {
    anchor: 'right-center',
    width: 50,
    maxHeight: '80%',
    offsetX: -1,
  })
}

export function showHelpOverlay(ctx: TuiContext): void {
  if (ctx.helpOverlayHandle?.isHidden() === false) {
    ctx.helpOverlayHandle.hide()
    ctx.helpOverlayHandle = null
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
    `   ${colors.inputPrompt('/sessions')}       ${colors.dim('List saved sessions')}\n` +
    `   ${colors.inputPrompt('/session')} [id]   ${colors.dim('Session info / delete / title')}\n` +
    `   ${colors.inputPrompt('/fork')}           ${colors.dim('Branch a new session')}\n` +
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
  ctx.helpOverlayHandle = ctx.tui.showOverlay(helpBox, {
    anchor: 'center',
    width: 46,
    maxHeight: 22,
  })
}

export function updateFooter(ctx: TuiContext): void {
  const plans = listPlans(ctx.config.cwd)
  ctx.footer.setAgentStatus(ctx.isRunning ? 'running' : 'idle')
  ctx.footer.setMode(
    ctx.session?.config.mode === 'plan'
      ? 'plan'
      : ctx.session?.config.mode === 'ask'
        ? 'ask'
        : ctx.session?.config.mode === 'loop'
          ? 'loop'
          : 'code',
  )
  ctx.footer.setModel(ctx.config.model, ctx.config.provider)
  const tokenStats = loadTokenUsage(ctx.config.cwd)
  ctx.footer.setTokenUsage(
    tokenStats.totalInputTokens,
    tokenStats.totalOutputTokens,
    tokenStats.totalApiCalls,
  )
  ctx.tui.requestRender(true)
}

export function refreshPlans(ctx: TuiContext): void {
  const plans = listPlans(ctx.config.cwd)
  ctx.plansList.refresh(plansToItems(plans))
  ctx.todoPanel.refresh()
  updateFooter(ctx)
}

export async function refreshBalance(ctx: TuiContext): Promise<void> {
  try {
    if (isDeepSeekOfficial(ctx.config.baseUrl) && ctx.config.apiKey) {
      const balance = await fetchDeepSeekBalance(ctx.config.apiKey)
      if (balance.isAvailable && balance.display) {
        ctx.footer.setBalance(balance.display)
        ctx.footer.setWebBalance(balance.webDisplay)
      } else {
        ctx.footer.setBalance('')
        ctx.footer.setWebBalance('')
      }
      ctx.tui.requestRender(true)
    }
  } catch {
    // Silently ignore
  }
}
