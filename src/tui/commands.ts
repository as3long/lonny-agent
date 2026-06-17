import { resetGlobalEventBus } from '../agent/event-bus.js'
import { ensurePromptsDir, loadPromptTemplates } from '../agent/prompt-templates.js'
import { Session } from '../agent/session.js'
import { ensureSkillsDir, loadSkills } from '../agent/skills.js'
import { resetTokenUsage } from '../config/tokens.js'
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

export async function sendMessage(ctx: TuiContext, text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  ctx.editor.setText('')
  ctx.editor.addToHistory(trimmed)

  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(' ')

    if (cmd === 'exit' || cmd === 'quit') {
      ctx.chatContent += `\n${colors.dim('Goodbye!')}\n`
      ctx.chatMarkdown.setText(ctx.chatContent)
      ctx.tui.stop()
      process.exit(0)
      return
    }

    if (cmd === 'new') {
      if (ctx.isRunning) {
        ctx.session.stop()
        ctx.isRunning = false
        ctx.loader.setMessage('')
        ctx.tui.setShowHardwareCursor(true)
      }
      Session.clearSavedSession(ctx.config.cwd)
      resetTokenUsage(ctx.config.cwd)
      resetGlobalEventBus()
      ctx.session = new Session(ctx.config, ctx.output)
      ctx.session.onPlanWritten = ctx.planCb
      ctx.chatContent = ''
      ctx.chatMarkdown.setText('')
      ctx.plansList.clearFilter()
      ;(ctx.editor as any).undoStack.clear()
      ;(ctx.editor as any).history = []
      ;(ctx.editor as any).killRing.ring = []
      updateFooter(ctx)
      return
    }

    if (cmd === 'mode') {
      if (arg === 'code' || arg === 'plan' || arg === 'ask' || arg === 'loop') {
        await ctx.session.setMode(arg)
        const modeColor =
          arg === 'ask'
            ? colors.success(arg)
            : arg === 'loop'
              ? colors.accent(arg)
              : colors.warn(arg)
        ctx.chatContent += `\n${colors.warn('\u21E8')} Switched to ${modeColor} mode\n`
        ctx.chatMarkdown.setText(ctx.chatContent)
        updateFooter(ctx)
      } else {
        ctx.chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/mode code|plan|ask|loop')}  (current: ${ctx.session.config.mode})\n`
        ctx.chatMarkdown.setText(ctx.chatContent)
      }
      return
    }

    if (cmd === 'model') {
      if (arg) {
        ctx.session.config.model = arg
        await ctx.session.setMode(ctx.session.config.mode)
        ctx.chatContent += `\n${colors.warn('\u21E8')} Model switched to ${colors.warn(arg)}\n`
        ctx.chatMarkdown.setText(ctx.chatContent)
        updateFooter(ctx)
      } else {
        ctx.chatContent += `\n${colors.inputPrompt('Current model:')} ${colors.dim(ctx.session.config.model)}\n`
        ctx.chatMarkdown.setText(ctx.chatContent)
      }
      return
    }

    if (cmd === 'prompts') {
      const templates = loadPromptTemplates(ctx.config.cwd)
      if (templates.length === 0) {
        ctx.chatContent += `\n${colors.warn('No prompt templates found.')} ${colors.dim('Create .md files in .lonny/prompts/')}\n`
      } else {
        ctx.chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Prompt Templates (${templates.length})`)}\n`
        for (const t of templates) {
          ctx.chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(t.name)}`
          if (t.description) ctx.chatContent += ` ${colors.dim(`\u2014 ${t.description}`)}`
          ctx.chatContent += '\n'
        }
      }
      ctx.chatMarkdown.setText(ctx.chatContent)
      return
    }

    if (cmd === 'skills') {
      const skills = loadSkills(ctx.config.cwd)
      if (skills.length === 0) {
        ctx.chatContent += `\n${colors.warn('No skills loaded.')} ${colors.dim('Create .md files in .lonny/skills/')}\n`
      } else {
        ctx.chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Active Skills (${skills.length})`)}\n`
        for (const s of skills) {
          ctx.chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(s.name)}`
          if (s.description) ctx.chatContent += ` ${colors.dim(`\u2014 ${s.description}`)}`
          ctx.chatContent += '\n'
        }
      }
      ctx.chatMarkdown.setText(ctx.chatContent)
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

    if (cmd === 'sessions') {
      const allSessions = Session.listSessions()
      if (allSessions.length === 0) {
        ctx.chatContent += `\n${colors.warn('No saved sessions found.')}\n`
      } else {
        ctx.chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Saved Sessions (${allSessions.length})`)}\n`
        ctx.chatContent += `  ${colors.dim('ID        Title                                       Mode    Messages  Tokens    Updated')}\n`
        for (const s of allSessions) {
          const id = s.id.padEnd(9)
          const title = (s.title || '(untitled)').slice(0, 42).padEnd(43)
          const mode = s.mode.padEnd(7)
          const msgs = String(s.messageCount).padEnd(9)
          const tokens = String(s.totalInputTokens + s.totalOutputTokens).padEnd(9)
          const date = s.updatedAt.slice(0, 10)
          ctx.chatContent += `  ${colors.dim(id)} ${colors.inputPrompt(title)} ${colors.dim(mode)} ${msgs} ${tokens} ${date}\n`
        }
        ctx.chatContent += `\n  ${colors.dim('Use /session delete <id> to delete a session')}\n`
      }
      ctx.chatMarkdown.setText(ctx.chatContent)
      return
    }

    if (cmd === 'session') {
      if (arg === 'delete' || arg.startsWith('delete ')) {
        const id = arg.slice(arg.startsWith('delete ') ? 7 : 6).trim()
        if (id) {
          const deleted = Session.deleteSession(id)
          if (deleted) {
            ctx.chatContent += `\n${colors.success('\u2714')} Deleted session ${colors.dim(id)}\n`
          } else {
            ctx.chatContent += `\n${colors.error('\u2716')} Session not found: ${colors.dim(id)}\n`
          }
        } else {
          ctx.chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/session delete <id>')}\n`
        }
      } else if (arg.startsWith('title ')) {
        const title = arg.slice(6).trim()
        if (title) {
          ctx.session.sessionTitle = title
          ctx.session.save()
          ctx.chatContent += `\n${colors.success('\u2714')} Session titled: ${colors.warn(title)}\n`
        } else {
          ctx.chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/session title <name>')}\n`
        }
      } else if (arg === 'export') {
        try {
          const filePath = ctx.session.exportSession()
          ctx.chatContent += `\n${colors.success('\u2714')} Session exported to ${colors.dim(filePath)}\n`
        } catch (err) {
          ctx.chatContent += `\n${colors.error('\u2716')} Export failed: ${fmtErr(err)}\n`
        }
      } else if (arg === 'switch' || arg.startsWith('switch ')) {
        const id = arg.startsWith('switch ') ? arg.slice(7).trim() : ''
        if (!id) {
          ctx.chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/session switch <id>')}. ${colors.dim('Use /sessions to list session IDs.')}\n`
        } else if (ctx.isRunning) {
          ctx.chatContent += `\n${colors.error('\u2716')} Cannot switch session while agent is running. ${colors.dim('Wait or use /stop first.')}\n`
        } else {
          const switched = await Session.loadById(id, ctx.config, ctx.output)
          if (switched) {
            ctx.session = switched
            ctx.session.onPlanWritten = ctx.planCb
            ctx.chatContent = `\n${colors.accent('\u21BA')} Switched to session ${colors.warn(ctx.session.sessionTitle || ctx.session.sessionId)}\n`
            const lastUserMsg = [...ctx.session.messages]
              .reverse()
              .find((m: any) => m.role === 'user')
            if (lastUserMsg && typeof lastUserMsg.content === 'string') {
              const preview =
                lastUserMsg.content.length > 80
                  ? `${lastUserMsg.content.slice(0, 80)}\u2026`
                  : lastUserMsg.content
              ctx.chatContent += ` ${colors.dim('Last question:')} ${colors.userLabel(preview)}\n`
            }
            ctx.chatContent += '\n'
            ctx.chatMarkdown.setText(ctx.chatContent)
            updateFooter(ctx)
          } else {
            ctx.chatContent += `\n${colors.error('\u2716')} Session not found: ${colors.dim(id)}\n`
          }
        }
      } else {
        const id = ctx.session.sessionId
        const title = ctx.session.sessionTitle || '(untitled)'
        const mode = ctx.session.config.mode
        const model = ctx.session.config.model
        const provider = ctx.session.config.provider
        const msgs = ctx.session.messages.length
        const totalIn = ctx.session.totalInputTokens
        const totalOut = ctx.session.totalOutputTokens
        const totalApi = ctx.session.totalApiCalls
        const created = ctx.session.sessionCreatedAt.slice(0, 10)
        ctx.chatContent +=
          `\n${colors.accent('\u2501').repeat(30)}\n` +
          ` ${colors.accent('\u25B6')} ${colors.warn('Session Info')}\n` +
          `${colors.accent('\u2501').repeat(30)}\n` +
          ` ${colors.dim('ID:')}       ${id}\n` +
          ` ${colors.dim('Title:')}    ${title}\n` +
          ` ${colors.dim('Mode:')}     ${mode}\n` +
          ` ${colors.dim('Model:')}    ${model} (${provider})\n` +
          ` ${colors.dim('Messages:')} ${msgs}\n` +
          ` ${colors.dim('Tokens:')}   ${totalIn + totalOut} (in: ${totalIn}, out: ${totalOut})\n` +
          ` ${colors.dim('API Calls:')} ${totalApi}\n` +
          ` ${colors.dim('Created:')}  ${created}\n` +
          `${colors.accent('\u2501').repeat(30)}\n`
      }
      ctx.chatMarkdown.setText(ctx.chatContent)
      return
    }

    if (cmd === 'fork') {
      if (ctx.isRunning) {
        ctx.chatContent += `\n${colors.error('\u2716')} Cannot fork while agent is running. ${colors.dim('Wait or use /stop first.')}\n`
      } else if (ctx.session.messages.length <= 1) {
        ctx.chatContent += `\n${colors.warn('No conversation to fork.')} ${colors.dim('Start a conversation first.')}\n`
      } else {
        const forked = ctx.session.fork()
        ctx.session = forked
        ctx.session.onPlanWritten = ctx.planCb
        const baseTitle = ctx.session.sessionTitle || 'forked session'
        ctx.chatContent += `\n${colors.accent('\u2442')} Forked new session: ${colors.warn(baseTitle)}\n`
        ctx.chatContent += `  ${colors.dim('ID:')} ${ctx.session.sessionId}\n`
      }
      ctx.chatMarkdown.setText(ctx.chatContent)
      return
    }

    if (cmd === 'help' || cmd === '?') {
      showHelpOverlay(ctx)
      return
    }

    if (cmd === 'init') {
      ensureSkillsDir(ctx.config.cwd)
      ensurePromptsDir(ctx.config.cwd)
      ctx.chatContent += `\n${colors.success('\u2714')} Initialized .lonny/skills/ and .lonny/prompts/\n`
      ctx.chatMarkdown.setText(ctx.chatContent)
      return
    }

    if (cmd === 'stop') {
      if (!ctx.isRunning) {
        ctx.chatContent += `\n${colors.dim('Agent is not running.')}\n`
        ctx.chatMarkdown.setText(ctx.chatContent)
        return
      }
      ctx.session.stop()
      ctx.chatContent += `\n${colors.warn('\u23F9')} Stopping agent...\n`
      ctx.chatMarkdown.setText(ctx.chatContent)
      ctx.isRunning = false
      ctx.loader.stop()
      ctx.loader.setMessage('')
      ctx.tui.setShowHardwareCursor(true)
      updateFooter(ctx)
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
