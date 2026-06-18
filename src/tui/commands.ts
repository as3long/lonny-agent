import type { CommandUI } from '../agent/commands.js'
import { dispatchCommand } from '../agent/commands.js'
import { fmtErr } from '../tools/errors.js'
import { colors } from './components/index.js'
import type { TuiContext } from './overlays.js'
import {
  refreshBalance,
  refreshPlans,
  showHelpOverlay,
  showPlansOverlay,
  updateFooter,
} from './overlays.js'

export function handleConfirmInput(ctx: TuiContext, data: string): boolean {
  if (!ctx.pendingConfirmResolve) return false
  const key = data.trim().toLowerCase()
  if (key === 'y' || key === 'yes') {
    ctx.pendingConfirmResolve(true)
    ctx.pendingConfirmResolve = null
    ctx.chatContent += 'y\n'
    ctx.chatMarkdown.setText(ctx.chatContent)
    ctx.tui.requestRender(true)
    return true
  } else if (key === 'n' || key === 'no' || key === '\r' || key === '') {
    ctx.pendingConfirmResolve(false)
    ctx.pendingConfirmResolve = null
    ctx.chatContent += 'N\n'
    ctx.chatMarkdown.setText(ctx.chatContent)
    ctx.tui.requestRender(true)
    return true
  }
  return false
}

function makeCommandUI(ctx: TuiContext): CommandUI {
  return {
    write: (text: string) => {
      ctx.chatContent += '\n' + text + '\n'
      ctx.chatMarkdown.setText(ctx.chatContent)
    },
    replaceContent: (text: string) => {
      ctx.chatContent = text
      ctx.chatMarkdown.setText(text)
    },
    onStateChange: () => {
      updateFooter(ctx)
    },
    onNewSession: (session: any) => {
      ctx.session = session
      ctx.session.onPlanWritten = ctx.planCb
      ctx.plansList.clearFilter()
      ;(ctx.editor as any).undoStack.clear()
      ;(ctx.editor as any).history = []
      ;(ctx.editor as any).killRing.ring = []
    },
  }
}

export async function sendMessage(ctx: TuiContext, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  ctx.editor.setText('')
  ctx.editor.addToHistory(trimmed)

  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(' ')

    // TUI-specific commands
    if (cmd === 'exit' || cmd === 'quit') {
      ctx.chatContent += `\n${colors.dim('Goodbye!')}\n`
      ctx.chatMarkdown.setText(ctx.chatContent)
      ctx.tui.stop()
      process.exit(0)
      return
    }
    if (cmd === 'plans') {
      showPlansOverlay(ctx)
      return
    }
    if (cmd === 'filter') {
      ctx.plansList.setFilter(arg)
      ctx.tui.requestRender(true)
      return
    }
    if (cmd === 'help' || cmd === '?') {
      showHelpOverlay(ctx)
      return
    }

    // Shared commands
    const ui = makeCommandUI(ctx)
    const handled = await dispatchCommand(
      { session: ctx.session, config: ctx.config, ui, isRunning: ctx.isRunning },
      cmd,
      arg,
    )
    if (handled) {
      ctx.tui.requestRender(true)
      return
    }

    ctx.chatContent += `\n${colors.error('\u2716')} Unknown command: /${cmd}. ${colors.dim('Type /help for available commands.')}\n`
    ctx.chatMarkdown.setText(ctx.chatContent)
    return
  }

  if (ctx.isRunning) return

  ctx.isRunning = true
  ctx.loader.setMessage('thinking...')
  ctx.tui.setShowHardwareCursor(false)
  updateFooter(ctx)

  ctx.session
    .chat(trimmed)
    .then(() => {
      ctx.isRunning = false
      ctx.loader.setMessage('')
      refreshPlans(ctx)
      ctx.tui.setShowHardwareCursor(true)
      updateFooter(ctx)
      refreshBalance(ctx)
    })
    .catch((err: unknown) => {
      ctx.isRunning = false
      ctx.loader.setMessage('')
      const errMsg = fmtErr(err)
      ctx.chatContent += `\n${colors.error('\u2716 Error:')} ${errMsg}\n`
      ctx.chatMarkdown.setText(ctx.chatContent)
      ctx.tui.setShowHardwareCursor(true)
      updateFooter(ctx)
    })
}
