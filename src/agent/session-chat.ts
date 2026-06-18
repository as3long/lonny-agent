import { saveTokenUsage } from '../config/tokens.js'
import { fmtErr } from '../tools/errors.js'
import type { ToolCall, ToolResult } from '../tools/types.js'
import { compact, shouldCompact } from './compaction.js'
import { EventChannels, getGlobalEventBus } from './event-bus.js'
import type { LLMMessage } from './llm.js'
import type { Session, SessionOutput } from './session.js'
import {
  GY,
  printTokenStats,
  printToolInvocation,
  printToolResult,
  printUserMessage,
  RE,
  RS,
  TH,
  THINK_PREFIX_WIDTH,
  termWidth,
  thinkBottomBorder,
  thinkTopBorder,
  visibleWidth,
  writeOut,
} from './session-display.js'
import { logToolError } from './session-persistence.js'
import { getContinuationMessage, isTaskCompleteMessage, sanitizeMessages } from './session-utils.js'

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

// ── runChat ──────────────────────────────────────────────────────────────────

export async function runChat(session: Session, userPrompt: string): Promise<void> {
  const bus = getGlobalEventBus()
  const out = session.output
  printUserMessage(userPrompt, out)
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
    let reasoningLineStart = false

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
            bus.emit(EventChannels.THINKING, { text: chunk.reasoning_content })
            if (!reasoningOutput) {
              reasoningOutput = true
              reasoningLineStart = true
              if (!out?.suppressToolOutput) {
                writeOut(thinkTopBorder(), out)
              }
            }
            if (!out?.suppressToolOutput) {
              let thinkCol = 0
              let remaining = chunk.reasoning_content
              const maxContentWidth = termWidth() - THINK_PREFIX_WIDTH
              while (remaining.length > 0) {
                if (reasoningLineStart) {
                  writeOut(`  ${GY}│${RS}${TH}`, out)
                  reasoningLineStart = false
                  thinkCol = 0
                }
                const nlIdx = remaining.indexOf('\n')
                if (nlIdx === -1) {
                  while (remaining.length > 0) {
                    const segWidth = visibleWidth(remaining)
                    const avail = maxContentWidth - thinkCol
                    if (segWidth <= avail) {
                      writeOut(remaining, out)
                      thinkCol += segWidth
                      remaining = ''
                    } else if (avail <= 0) {
                      writeOut(`${RS}\n`, out)
                      writeOut(`  ${GY}│${RS}${TH}`, out)
                      thinkCol = 0
                    } else {
                      let cut = avail
                      while (cut > 0 && visibleWidth(remaining.slice(0, cut)) > avail) cut--
                      if (cut <= 0) cut = 1
                      writeOut(remaining.slice(0, cut), out)
                      writeOut(`${RS}\n`, out)
                      writeOut(`  ${GY}│${RS}${TH}`, out)
                      thinkCol = 0
                      remaining = remaining.slice(cut)
                    }
                  }
                } else {
                  const segment = remaining.slice(0, nlIdx)
                  const segWidth = visibleWidth(segment)
                  const avail = maxContentWidth - thinkCol
                  if (segWidth <= avail) {
                    writeOut(segment, out)
                    writeOut(`${RS}\n`, out)
                    reasoningLineStart = true
                    thinkCol = 0
                  } else {
                    let rest = segment
                    if (avail > 0) {
                      let cut = avail
                      while (cut > 0 && visibleWidth(rest.slice(0, cut)) > avail) cut--
                      if (cut <= 0) cut = 1
                      writeOut(rest.slice(0, cut), out)
                      rest = rest.slice(cut)
                    }
                    writeOut(`${RS}\n`, out)
                    reasoningLineStart = true
                    thinkCol = 0
                    if (rest.length > 0) {
                      writeOut(`  ${GY}│${RS}${TH}`, out)
                      reasoningLineStart = false
                      while (rest.length > 0) {
                        const rw = visibleWidth(rest)
                        if (rw <= maxContentWidth) {
                          writeOut(rest, out)
                          thinkCol = rw
                          rest = ''
                        } else {
                          let cut = maxContentWidth
                          while (cut > 0 && visibleWidth(rest.slice(0, cut)) > maxContentWidth)
                            cut--
                          if (cut <= 0) cut = 1
                          writeOut(rest.slice(0, cut), out)
                          writeOut(`${RS}\n`, out)
                          writeOut(`  ${GY}│${RS}${TH}`, out)
                          rest = rest.slice(cut)
                        }
                      }
                    }
                    writeOut(`${RS}\n`, out)
                    reasoningLineStart = true
                    thinkCol = 0
                  }
                  remaining = remaining.slice(nlIdx + 1)
                }
              }
            }
          }
        }
        if (chunk.type === 'text' && chunk.text) {
          if (reasoningOutput) {
            bus.emit(EventChannels.THINKING_END, {})
            if (!out?.suppressToolOutput) {
              writeOut(`${RS}\n`, out)
              writeOut(thinkBottomBorder(), out)
            }
            reasoningOutput = false
            reasoningLineStart = false
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
              printTokenStats(
                session.turnInputTokens,
                session.turnOutputTokens,
                session.totalInputTokens,
                session.totalOutputTokens,
                session.turnApiCalls,
                session.totalApiCalls,
                out,
                session.turnCacheHitTokens,
                session.turnCacheMissTokens,
                session.totalCacheHitTokens,
                session.totalCacheMissTokens,
              )
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
            writeOut(`${RS}\n`, out)
            writeOut(thinkBottomBorder(), out)
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
        writeOut(`${RS}\n`, out)
        writeOut(thinkBottomBorder(), out)
      }
      reasoningOutput = false
      reasoningLineStart = false
    }

    if (toolCalls.length === 0) {
      if (fullResponse) {
        const finalAssistantMsg: LLMMessage = {
          role: 'assistant',
          content: fullResponse,
          reasoning_content: reasoningContent,
        }
        session.messages.push(finalAssistantMsg)
        printTokenStats(
          session.turnInputTokens,
          session.turnOutputTokens,
          session.totalInputTokens,
          session.totalOutputTokens,
          session.turnApiCalls,
          session.totalApiCalls,
          out,
          session.turnCacheHitTokens,
          session.turnCacheMissTokens,
          session.totalCacheHitTokens,
          session.totalCacheMissTokens,
        )
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
      if (!out?.suppressToolOutput) {
        printToolInvocation(tc, out)
      }
      const result: ToolResult = await session.registry.dispatch(tc)
      if (result.success) {
        bus.emit(EventChannels.TOOL_RESULT, { name: tc.name, id: tc.id, output: result.output })
      } else {
        bus.emit(EventChannels.TOOL_ERROR, { name: tc.name, id: tc.id, error: result.error })
        logToolError(tc, result, session.sessionId)
      }
      if (!out?.suppressToolOutput) {
        printToolResult(tc, result, out)
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
    printTokenStats(
      session.turnInputTokens,
      session.turnOutputTokens,
      session.totalInputTokens,
      session.totalOutputTokens,
      session.turnApiCalls,
      session.totalApiCalls,
      out,
      session.turnCacheHitTokens,
      session.turnCacheMissTokens,
      session.totalCacheHitTokens,
      session.totalCacheMissTokens,
    )
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
