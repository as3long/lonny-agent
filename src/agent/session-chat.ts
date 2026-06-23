import { formatToolInput } from '../api/display-utils.js'
import { saveTokenUsage } from '../config/tokens.js'
import { fmtErr } from '../tools/errors.js'
import type { ToolCall, ToolResult } from '../tools/types.js'
import { compact, shouldCompact } from './compaction.js'
import { EventChannels, getGlobalEventBus } from './event-bus.js'
import type { LLMMessage } from './llm.js'
import type { Session, SessionOutput } from './session.js'
import { GY, RE, RS, THINK_END_MARKER, THINK_START_MARKER, writeOut } from './session-display.js'
import { logToolError } from './session-persistence.js'
import { getContinuationMessage, isTaskCompleteMessage, sanitizeMessages } from './session-utils.js'

function formatToolResultText(tc: ToolCall, result: ToolResult): string {
  const status = result.success ? 'OK' : 'ERROR'
  if (!result.success) {
    return `[TOOL ${tc.name} ${status}]\n${result.error || tc.name}\n[/TOOL]\n`
  }
  let summary = ''
  const details: string[] = []
  if (tc.name === 'read') {
    const fileCount = (result.output.match(/^=== /gm) || []).length
    summary = `read ${fileCount} file(s)`
    for (const line of result.output.split('\n')) {
      if (line.startsWith('=== ')) {
        const fp = line.slice(4, line.includes(' ===') ? line.indexOf(' ===') + 4 : undefined)
        details.push(fp)
      }
    }
  } else if (tc.name === 'glob') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    summary = `glob ${count} match(es)`
  } else if (tc.name === 'grep') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    summary = `grep ${count} match(es)`
  } else if (tc.name === 'bash') {
    const outLines = result.output.split('\n')
    summary = outLines.length > 1 ? `bash (${outLines.length} lines)` : 'bash'
  } else if (tc.name === 'edit') {
    summary = 'edit'
    for (const l of result.output.split('\n')) {
      const clean = l.replace(/\x1b\[[0-9;]*m/g, '').trim()
      if (clean) details.push(clean)
    }
  } else if (tc.name === 'write_plan') {
    summary = result.output || tc.name
  } else if (tc.name === 'search') {
    summary = `search: ${String(tc.input.query || '').slice(0, 80)}`
  } else {
    summary = tc.name
  }
  const body = [summary, ...details].join('\n')
  return `[TOOL ${tc.name} ${status}]\n${body}\n[/TOOL]\n`
}

// ── Context compaction helper ─────────────────────────────────────────────────

function tryCompact(
  session: Session,
  out: SessionOutput | undefined,
  bus: ReturnType<typeof getGlobalEventBus>,
): void {
  if (shouldCompact(session.messages, session.config.contextWindow)) {
    const before = session.messages.length
    const result = compact(session.messages, session.config.contextWindow)
    if (result.compressed) {
      session.messages = result.messages
      bus.emit(EventChannels.COMPACTION_TRIGGERED, { before, after: result.newCount })
      if (out && !out.suppressToolOutput) {
        out.write(
          `\n  ${GY}┃${RS} ${GY}📦 Compressed context: ${before} → ${result.newCount} messages${RS}\n`,
        )
      }
    }
  }
}

function emitTokenStats(
  bus: ReturnType<typeof getGlobalEventBus>,
  session: Session,
  out: SessionOutput | undefined,
): void {
  bus.emit(EventChannels.TOKEN_STATS, {
    turnIn: session.turnInputTokens,
    turnOut: session.turnOutputTokens,
    totalIn: session.totalInputTokens,
    totalOut: session.totalOutputTokens,
    turnApi: session.turnApiCalls,
    totalApi: session.totalApiCalls,
    turnCacheHit: session.turnCacheHitTokens,
    turnCacheMiss: session.turnCacheMissTokens,
    totalCacheHit: session.totalCacheHitTokens,
    totalCacheMiss: session.totalCacheMissTokens,
  })
  if (out?.suppressToolOutput) return
  const total = session.totalInputTokens + session.totalOutputTokens
  const cacheHit = session.totalCacheHitTokens ?? 0
  const cacheMiss = session.totalCacheMissTokens ?? 0
  const cacheTotal = cacheHit + cacheMiss
  let msg = `▴${session.turnInputTokens} ▾${session.turnOutputTokens}  total ${total}  calls ${session.turnApiCalls}(${session.totalApiCalls})`
  if (cacheTotal > 0) {
    const pct = Math.round((cacheHit / cacheTotal) * 100)
    msg += `  cached ${pct}%`
  }
  writeOut(`\n[TOKEN_STATS]\n${msg}\n[/TOKEN_STATS]\n`, out)
}

function emitToolInvocation(tc: ToolCall, out: SessionOutput | undefined): void {
  const bus = getGlobalEventBus()
  bus.emit(EventChannels.TOOL_INVOCATION, { name: tc.name, input: tc.input, id: tc.id })
  if (out?.suppressToolOutput) return
  const detail = formatToolInput(tc)
  const isWrite = tc.name === 'write_plan' || tc.name === 'edit'
  const icon = isWrite ? '◆' : '◇'
  writeOut(`\n[TOOL_CALL ${tc.name} ${icon}]${detail ? ` ${detail}` : ''}\n[/TOOL_CALL]\n`, out)
}

// ── runChat ──────────────────────────────────────────────────────────────────

export async function runChat(session: Session, userPrompt: string): Promise<void> {
  const bus = getGlobalEventBus()
  const out = session.output
  bus.emit(EventChannels.USER_MESSAGE, { prompt: userPrompt })
  if (!out?.suppressToolOutput) {
    writeOut(`\n[USER]\n${userPrompt}\n[/USER]\n\n`, out)
  }
  session.messages.push({ role: 'user', content: userPrompt })
  session.save()

  session.turnInputTokens = 0
  session.turnOutputTokens = 0
  session.turnApiCalls = 0
  session.turnCacheHitTokens = 0
  session.turnCacheMissTokens = 0

  let iterations = 0
  const maxIterations = session.config.mode === 'loop' ? 500 : 30

  session.resetStopped()
  session.abortController = new AbortController()

  let toolCalls: ToolCall[] = []

  while (iterations < maxIterations) {
    if (session.isStopped()) {
      bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
      return
    }
    iterations++
    session.turnApiCalls++
    session.totalApiCalls++
    toolCalls = []
    let fullResponse = ''
    let reasoningContent: string | undefined
    let reasoningOutput = false

    bus.emit(EventChannels.TURN_START, { prompt: userPrompt, iteration: iterations })
    bus.emit(EventChannels.LLM_STREAM_START, { iteration: iterations })

    session.messages = sanitizeMessages(session.messages)
    const stream = session.provider.chat(
      session.messages,
      session.registry.getCoreDefinitions(),
      session.abortController.signal,
    )

    try {
      for await (const chunk of stream) {
        if (chunk.reasoning_content) {
          reasoningContent = chunk.reasoning_content
          if (!chunk.text) {
            if (!reasoningOutput) {
              bus.emit(EventChannels.THINKING, { text: '' })
              if (!out?.suppressToolOutput) {
                writeOut(`\n${THINK_START_MARKER}`, out)
              }
              reasoningOutput = true
            }
            bus.emit(EventChannels.THINKING, { text: chunk.reasoning_content })
            if (!out?.suppressToolOutput) {
              writeOut(chunk.reasoning_content, out)
            }
          }
        }
        if (chunk.type === 'text' && chunk.text) {
          if (reasoningOutput) {
            bus.emit(EventChannels.THINKING_END, {})
            if (!out?.suppressToolOutput) {
              writeOut(`${THINK_END_MARKER}\n`, out)
            }
            reasoningOutput = false
          }
          fullResponse += chunk.text
          writeOut(chunk.text, out)
        } else if (chunk.type === 'tool_use' && chunk.tool_call) {
          toolCalls.push(chunk.tool_call)
        } else if (chunk.type === 'complete') {
          if (chunk.usage) {
            session.turnInputTokens += chunk.usage.input_tokens
            session.turnOutputTokens += chunk.usage.output_tokens
            session.totalInputTokens += chunk.usage.input_tokens
            session.totalOutputTokens += chunk.usage.output_tokens
            if (chunk.usage.prompt_cache_hit_tokens != null) {
              session.turnCacheHitTokens += chunk.usage.prompt_cache_hit_tokens
              session.totalCacheHitTokens += chunk.usage.prompt_cache_hit_tokens
            }
            if (chunk.usage.prompt_cache_miss_tokens != null) {
              session.turnCacheMissTokens += chunk.usage.prompt_cache_miss_tokens
              session.totalCacheMissTokens += chunk.usage.prompt_cache_miss_tokens
            }
          }
          if (chunk.finish_reason === 'stop' || chunk.finish_reason === 'end_turn') {
            if (toolCalls.length === 0) {
              const finalAssistantMsg: LLMMessage = {
                role: 'assistant',
                content: fullResponse || null,
                reasoning_content: reasoningContent,
              }
              session.messages.push(finalAssistantMsg)
              emitTokenStats(bus, session, out)
              writeOut('\n\n', out)
              saveTokenUsage(
                session.config.cwd,
                session.turnInputTokens,
                session.turnOutputTokens,
                session.turnApiCalls,
              )
              bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: 0 })
              session.save()
              if (session.config.mode === 'loop' && !session.isStopped()) {
                if (isTaskCompleteMessage(fullResponse)) {
                  session.save()
                  return
                }
                const contMsg = getContinuationMessage(session.messages)
                session.messages.push({ role: 'user', content: contMsg })
                session.turnInputTokens = 0
                session.turnOutputTokens = 0
                session.turnApiCalls = 0
                session.turnCacheHitTokens = 0
                session.turnCacheMissTokens = 0
                continue
              }
              return
            }
          }
        }
      }
    } catch (e) {
      const errMsg = fmtErr(e)
      if (!session.isStopped()) {
        const partialContent = fullResponse ? fullResponse.slice(0, 500) : '(empty)'
        if (!out?.suppressToolOutput) {
          writeOut(`\n${RE}Stream error:${RS} ${errMsg}`, out)
          writeOut(`\n  ${GY}┃${RS} Partial response: ${partialContent}\n`, out)
        }
        console.error('[session] Stream error:', errMsg, '| Partial response:', partialContent)
        if (reasoningOutput) {
          bus.emit(EventChannels.THINKING_END, {})
          if (!out?.suppressToolOutput) {
            writeOut(`${THINK_END_MARKER}\n`, out)
          }
        }
        bus.emit(EventChannels.LLM_STREAM_END, { iteration: iterations, toolCallCount: 0 })
        bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: 0 })

        if (toolCalls.length > 0) {
          const interruptedMsg: LLMMessage = {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
            reasoning_content: reasoningContent,
          }
          session.messages.push(interruptedMsg)
        }

        saveTokenUsage(
          session.config.cwd,
          session.turnInputTokens,
          session.turnOutputTokens,
          session.turnApiCalls,
        )
        session.save()
      }
      return
    }

    bus.emit(EventChannels.LLM_STREAM_END, {
      iteration: iterations,
      toolCallCount: toolCalls.length,
    })

    if (reasoningOutput) {
      bus.emit(EventChannels.THINKING_END, {})
      if (!out?.suppressToolOutput) {
        writeOut(`${THINK_END_MARKER}\n`, out)
      }
      reasoningOutput = false
    }

    if (toolCalls.length === 0) {
      if (fullResponse) {
        const finalAssistantMsg: LLMMessage = {
          role: 'assistant',
          content: fullResponse,
          reasoning_content: reasoningContent,
        }
        session.messages.push(finalAssistantMsg)
        emitTokenStats(bus, session, out)
        writeOut('\n\n', out)
      }
      saveTokenUsage(
        session.config.cwd,
        session.turnInputTokens,
        session.turnOutputTokens,
        session.turnApiCalls,
      )
      bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: 0 })
      session.save()
      if (session.config.mode === 'loop' && !session.isStopped()) {
        if (fullResponse && isTaskCompleteMessage(fullResponse)) {
          session.save()
          return
        }
        const contMsg = getContinuationMessage(session.messages)
        session.messages.push({ role: 'user', content: contMsg })
        session.turnInputTokens = 0
        session.turnOutputTokens = 0
        session.turnApiCalls = 0
        session.turnCacheHitTokens = 0
        session.turnCacheMissTokens = 0
        continue
      }
      return
    }

    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: fullResponse || null,
      tool_calls: toolCalls,
      reasoning_content: reasoningContent,
    }
    session.messages.push(assistantMsg)

    if (!session.config.autoApprove && session.output?.confirmTool && toolCalls.length > 0) {
      const writeTools = ['edit', 'bash', 'write_plan', 'install_skill']
      const needsConfirm = toolCalls.filter(tc => writeTools.includes(tc.name))
      if (needsConfirm.length > 0) {
        const approved = await session.output.confirmTool(needsConfirm)
        if (!approved) {
          const rejectMsg: LLMMessage = {
            role: 'tool',
            content:
              'USER_REJECTED: The user declined to execute the requested tool calls. Try a different approach.',
            tool_call_id: needsConfirm[0].id,
            name: 'user_feedback',
          }
          session.messages.push(rejectMsg)
          bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
          continue
        }
      }
    }

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      if (session.isStopped()) {
        const remainingToolCalls = toolCalls.slice(i)
        if (remainingToolCalls.length > 0) {
          const interruptedMsg: LLMMessage = {
            role: 'assistant',
            content: null,
            tool_calls: remainingToolCalls,
          }
          session.messages.push(interruptedMsg)
        }
        bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
        return
      }
      bus.emit(EventChannels.TOOL_CALL, { name: tc.name, input: tc.input, id: tc.id })
      emitToolInvocation(tc, out)
      const result: ToolResult = await session.registry.dispatch(tc)
      if (result.success) {
        bus.emit(EventChannels.TOOL_RESULT, { name: tc.name, id: tc.id, output: result.output })
      } else {
        bus.emit(EventChannels.TOOL_ERROR, { name: tc.name, id: tc.id, error: result.error })
        logToolError(tc, result, session.sessionId)
      }
      if (!out?.suppressToolOutput) {
        writeOut(formatToolResultText(tc, result), out)
      }

      const resultMsg: LLMMessage = {
        role: 'tool',
        content: result.success ? result.output : `ERROR: ${result.error}`,
        tool_call_id: tc.id,
        name: tc.name,
      }
      session.messages.push(resultMsg)
      tryCompact(session, out, bus)

      if (tc.name === 'task_complete') {
        session.save()
        session.stopped = true
        break
      }
    }

    session.save()
    bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })

    tryCompact(session, out, bus)
  }

  if (iterations >= maxIterations) {
    emitTokenStats(bus, session, out)
    writeOut('\nAgent reached maximum iterations. Stopping.\n', out)
  }

  saveTokenUsage(
    session.config.cwd,
    session.turnInputTokens,
    session.turnOutputTokens,
    session.turnApiCalls,
  )
  session.save()
}
