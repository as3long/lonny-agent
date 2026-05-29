import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Config } from '../config/index.js'
import { saveTokenUsage } from '../config/tokens.js'
import { FileReadTracker } from '../diff/apply.js'
import { ToolRegistry } from '../tools/registry.js'
import type { ToolCall, ToolResult } from '../tools/types.js'
import { compact, estimateMessagesTokens, shouldCompact } from './compaction.js'
import { EventChannels, getGlobalEventBus } from './event-bus.js'
import type { LLMMessage, LLMProvider } from './llm.js'
import { buildSystemPrompt } from './prompt-builder.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { GoogleProvider } from './providers/google.js'
import { OllamaProvider } from './providers/ollama.js'
import { OpenAIProvider } from './providers/openai.js'

// ── Session persistence ────────────────────────────────────────────────────

interface SessionData {
  cwd: string
  messages: LLMMessage[]
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  mode: 'code' | 'plan' | 'ask'
  model: string
  provider: string
  updatedAt: string
}

function getSessionDir(): string {
  return path.join(os.homedir(), '.lonny', 'sessions')
}

function getSessionFilePath(cwd: string): string {
  const absPath = path.resolve(cwd)
  const hash = createHash('sha256').update(absPath, 'utf-8').digest('hex').slice(0, 12)
  const dirName = path.basename(absPath)
  const safeName = dirName.replace(/[<>:"/\\|?*]/g, '_')
  return path.join(getSessionDir(), `${safeName}-${hash}.json`)
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ── Colors ─────────────────────────────────────────────────────────────────

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const RE = '\x1b[31m'
const MG = '\x1b[35m'
const GY = '\x1b[90m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'
const TH = '\x1b[48;2;22;22;32m\x1b[38;2;150;150;170m' // dark bg + dim fg for thinking

/** Get terminal width (columns), default to 80. */
function termWidth(): number {
  return process.stdout.columns ?? 80
}

/** Visible width of a string (strip ANSI codes). ASCII=1, CJK/non-ASCII=2. */
function visibleWidth(s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x1b) {
      // Skip past escape sequence
      while (i < s.length && s[i] !== 'm') i++
      continue
    }
    w += s.charCodeAt(i) > 0x7e ? 2 : 1
  }
  return w
}

/** Visible prefix width for thinking box lines: "  │" = 3 */
const THINK_PREFIX_WIDTH = 3

/** Build the top border of the thinking box */
function thinkTopBorder(): string {
  return `\n  ${GY}╭───────${RS}${TH} Think ${GY}────────────────────${RS}\n`
}

/** Build the bottom border of the thinking box */
function thinkBottomBorder(): string {
  return `  ${GY}╰${'─'.repeat(42)}${RS}\n\n`
}

export interface SessionOutput {
  write: (text: string) => void
  /** When true, tool invocation/result formatting is skipped (TUI handles it via event bus) */
  suppressToolOutput?: boolean
  /**
   * When autoApprove is false, called before dispatching write-type tool calls.
   * Return true to allow execution, false to reject. Tools are batched — one confirmation per turn.
   */
  confirmTool?: (toolCalls: ToolCall[]) => Promise<boolean>
}

function writeOut(text: string, output?: SessionOutput): void {
  if (output) {
    output.write(text)
  } else {
    process.stdout.write(text)
  }
}

function printUserMessage(prompt: string, output?: SessionOutput): void {
  // When suppressToolOutput is true (Web UI mode), the frontend already
  // displays the user message, so skip sending it as a chunk.
  if (output?.suppressToolOutput) return
  const line = `  ${GY}┃${RS} ${BLD}${CY}You${RS}`
  writeOut(`\n${line}  ${prompt}\n\n`, output)
}

function printToolInvocation(tc: ToolCall, output?: SessionOutput): void {
  const detail = formatToolInput(tc)
  const isWrite = tc.name === 'write_plan' || tc.name === 'edit'
  const icon = isWrite ? `${YE}◆${RS}` : `${GR}◇${RS}`
  const label = isWrite ? `${YE}${tc.name}${RS}` : `${GR}${tc.name}${RS}`
  writeOut(`\n  ${GY}│${RS}  ${icon} ${label}${detail ? ` ${GY}${detail}${RS}` : ''}\n`, output)
}

function printToolResult(tc: ToolCall, result: ToolResult, output?: SessionOutput): void {
  if (!result.success) {
    writeOut(`  ${GY}│${RS}  ${RE}✖${RS} ${RE}${result.error}${RS}\n`, output)
    return
  }
  if (tc.name === 'read') {
    const fileCount = (result.output.match(/^=== /gm) || []).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} read ${fileCount} file(s)\n`, output)
    for (const line of result.output.split('\n')) {
      if (line.startsWith('=== ')) {
        const fp = line.slice(4, line.includes(' ===') ? line.indexOf(' ===') + 4 : undefined)
        writeOut(`  ${GY}│${RS}    ${GY}${fp}${RS}\n`, output)
      }
    }
  } else if (tc.name === 'glob') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} glob ${count} match(es)\n`, output)
  } else if (tc.name === 'grep') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} grep ${count} match(es)\n`, output)
  } else if (tc.name === 'bash') {
    const outLines = result.output.split('\n')
    const summary = outLines.length > 1 ? `(${outLines.length} lines)` : ''
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} bash ${summary}\n`, output)
  } else if (tc.name === 'edit') {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} edit\n`, output)
    if (result.output) {
      for (const l of result.output.split('\n')) {
        if (l.trim()) writeOut(`  ${GY}│${RS}  ${l.trim()}\n`, output)
      }
    }
  } else if (tc.name === 'write_plan') {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} ${result.output || tc.name}\n`, output)
  } else if (tc.name === 'search') {
    writeOut(
      `  ${GY}│${RS}  ${GR}✔${RS} search: ${String(tc.input.query || '').slice(0, 80)}\n`,
      output,
    )
  } else {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} ${tc.name}\n`, output)
  }
}

interface SingleEditShape {
  file_path: string
  old_string: string
  new_string: string
}

function isSingleEditShape(v: unknown): v is SingleEditShape {
  return (
    typeof v === 'object' &&
    v !== null &&
    'file_path' in v &&
    'old_string' in v &&
    'new_string' in v
  )
}

export function formatToolInput(tc: ToolCall): string {
  const parts: string[] = []
  if (tc.name === 'read' && Array.isArray(tc.input.paths)) {
    parts.push(tc.input.paths.join(', '))
  } else if (tc.name === 'glob' && typeof tc.input.pattern === 'string') {
    parts.push(tc.input.pattern)
  } else if (tc.name === 'grep') {
    if (typeof tc.input.pattern === 'string') parts.push(`/${tc.input.pattern}/`)
    if (typeof tc.input.include === 'string') parts.push(`in:${tc.input.include}`)
  } else if (tc.name === 'ls') {
    parts.push(typeof tc.input.path === 'string' ? tc.input.path : '.')
  } else if (tc.name === 'bash') {
    const cmd = typeof tc.input.command === 'string' ? tc.input.command : ''
    parts.push(cmd.length > 80 ? `${cmd.slice(0, 80)}\u2026` : cmd)
  } else if (tc.name === 'search') {
    if (typeof tc.input.query === 'string') parts.push(tc.input.query.slice(0, 120))
  } else if (tc.name === 'write_plan') {
    if (typeof tc.input.filename === 'string') parts.push(tc.input.filename)
  } else if (tc.name === 'edit') {
    if (Array.isArray(tc.input.edits) && tc.input.edits.every(isSingleEditShape)) {
      const paths = tc.input.edits.map(e => e.file_path)
      parts.push(paths.join(', '))
    }
  }
  return parts.join(' \u2502 ')
}

function printTokenStats(
  turnIn: number,
  turnOut: number,
  totalIn: number,
  totalOut: number,
  turnApi: number,
  totalApi: number,
  output?: SessionOutput,
): void {
  const bus = getGlobalEventBus()
  bus.emit(EventChannels.TOKEN_STATS, { turnIn, turnOut, totalIn, totalOut, turnApi, totalApi })
  // Skip terminal output in Web UI mode
  if (output?.suppressToolOutput) return
  const total = totalIn + totalOut
  const msg = `  ${GY}┃${RS} ${GY}${BLD}▴${RS}${GY}${turnIn}${RS} ${GY}${BLD}▾${RS}${GY}${turnOut}${RS}  ${GY}total${RS} ${total}  ${GY}calls${RS} ${turnApi}(${totalApi})`
  writeOut(`\n${msg}\n`, output)
}

export class Session {
  messages: LLMMessage[]
  provider: LLMProvider
  registry: ToolRegistry
  applier: FileReadTracker
  config: Config
  output?: SessionOutput
  private _onPlanWritten?: (display: string) => void
  /** Set the plan-written callback and propagate to ToolRegistry */
  set onPlanWritten(cb: ((display: string) => void) | undefined) {
    this._onPlanWritten = cb
    // Update context so setMode() picks it up too
    this.registry.updateContext({ onPlanWritten: cb })
    // Re-register write_plan tool with the new callback
    if (this.registry.has('write_plan')) {
      this.registry.reRegisterWritePlan(this.config.cwd, cb)
    }
  }
  get onPlanWritten(): ((display: string) => void) | undefined {
    return this._onPlanWritten
  }
  totalInputTokens: number = 0
  totalOutputTokens: number = 0
  turnInputTokens: number = 0
  turnOutputTokens: number = 0
  turnApiCalls: number = 0
  totalApiCalls: number = 0
  private stopped: boolean = false
  private abortController: AbortController | null = null

  constructor(config: Config, output?: SessionOutput) {
    this.config = config
    this.output = output
    this.applier = new FileReadTracker()
    this.registry = new ToolRegistry({
      cwd: config.cwd,
      autoApprove: config.autoApprove,
      applier: this.applier,
      mode: config.mode,
      onPlanWritten: this.onPlanWritten,
    })

    if (config.provider === 'openai') {
      this.provider = new OpenAIProvider(
        config.apiKey,
        config.baseUrl,
        config.model,
        config.thinking,
        config.reasoningEffort,
        config.enableCache,
        config.strictTools,
      )
    } else if (config.provider === 'google') {
      this.provider = new GoogleProvider(config.apiKey, config.baseUrl, config.model)
    } else if (config.provider === 'ollama') {
      this.provider = new OllamaProvider(config.apiKey, config.baseUrl, config.model)
    } else {
      this.provider = new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
    }

    this.messages = [{ role: 'system', content: buildSystemPrompt(config) }]
  }

  /** Persist the current session to ~/.lonny/sessions/ */
  save(): void {
    const dir = getSessionDir()
    ensureDir(dir)
    const filePath = getSessionFilePath(this.config.cwd)
    const data: SessionData = {
      cwd: path.resolve(this.config.cwd),
      messages: this.messages,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalApiCalls: this.totalApiCalls,
      mode: this.config.mode,
      model: this.config.model,
      provider: this.config.provider,
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }

  /** Try to load a saved session for the given cwd. Returns null if none exists. */
  static load(config: Config, output?: SessionOutput): Session | null {
    const filePath = getSessionFilePath(config.cwd)
    let data: SessionData
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SessionData
    } catch {
      return null
    }

    // Verify the cwd matches (in case of hash collision or directory rename)
    const savedAbs = path.resolve(data.cwd)
    const currentAbs = path.resolve(config.cwd)
    if (savedAbs !== currentAbs) {
      return null
    }

    const session = new Session(config, output)
    // Restore messages (replace the default system prompt with the saved one)
    session.messages = data.messages
    // Refresh the system prompt only if config actually changed (model, mode, etc.)
    // Compare the saved data vs current config to decide
    if (
      data.model !== config.model ||
      data.provider !== config.provider ||
      data.mode !== config.mode
    ) {
      session.messages[0] = { role: 'system', content: buildSystemPrompt(config) }
    }
    // Restore token stats
    session.totalInputTokens = data.totalInputTokens
    session.totalOutputTokens = data.totalOutputTokens
    session.totalApiCalls = data.totalApiCalls
    return session
  }

  /** Remove the saved session file for the given cwd. */
  static clearSavedSession(cwd: string): void {
    const filePath = getSessionFilePath(cwd)
    try {
      fs.unlinkSync(filePath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  setMode(mode: 'code' | 'plan' | 'ask'): void {
    this.config.mode = mode
    this.messages[0] = { role: 'system', content: buildSystemPrompt(this.config) }
    this.registry.setMode(mode)
    this.save()
  }

  /** Stop the current conversation gracefully */
  stop(): void {
    this.stopped = true
    // Abort any in-flight LLM stream to stop token consumption immediately
    this.abortController?.abort()
  }

  /** Check if the session was stopped */
  isStopped(): boolean {
    return this.stopped
  }

  /** Reset the stopped flag for a new conversation */
  resetStopped(): void {
    this.stopped = false
  }

  async chat(userPrompt: string): Promise<void> {
    const bus = getGlobalEventBus()
    const out = this.output
    printUserMessage(userPrompt, out)
    this.messages.push({ role: 'user', content: userPrompt })

    // Reset per-turn counters
    this.turnInputTokens = 0
    this.turnOutputTokens = 0
    this.turnApiCalls = 0

    let iterations = 0
    const maxIterations = 30

    // Reset stopped flag for new conversation
    this.resetStopped()
    // Create a new AbortController for this chat invocation
    // (a new controller is needed each time because abort() is one-shot)
    this.abortController = new AbortController()

    // Declare toolCalls outside the loop so we can reference it in stop check
    let toolCalls: ToolCall[] = []

    while (iterations < maxIterations) {
      // Check if stop was requested
      if (this.isStopped()) {
        bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
        this.save()
        return
      }
      iterations++
      this.turnApiCalls++
      this.totalApiCalls++
      toolCalls = []
      let fullResponse = ''
      let reasoningContent: string | undefined
      let reasoningOutput = false
      let reasoningLineStart = false

      bus.emit(EventChannels.TURN_START, { prompt: userPrompt, iteration: iterations })
      bus.emit(EventChannels.LLM_STREAM_START, { iteration: iterations })

      const stream = this.provider.chat(
        this.messages,
        this.registry.getDefinitions(),
        this.abortController.signal,
      )

      for await (const chunk of stream) {
        if (chunk.reasoning_content) {
          reasoningContent = chunk.reasoning_content
          // Stream reasoning content in real-time (only when no text in same chunk)
          if (!chunk.text) {
            // Emit thinking via EventBus for Web UI
            bus.emit(EventChannels.THINKING, { text: chunk.reasoning_content })
            if (!reasoningOutput) {
              reasoningOutput = true
              reasoningLineStart = true
              if (!out?.suppressToolOutput) {
                writeOut(thinkTopBorder(), out)
              }
            }
            // Terminal display with box drawing (skip in Web UI mode, handled by EventBus)
            if (!out?.suppressToolOutput) {
              // Track column position on current line for wrapping
              let thinkCol = 0
              // Handle newlines in streamed content - add left border on each new line
              // Also manually wrap long lines so wrapped lines keep the │ prefix.
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
                  // No newline — write as much as fits on current line, wrap if needed
                  while (remaining.length > 0) {
                    const segWidth = visibleWidth(remaining)
                    const avail = maxContentWidth - thinkCol
                    if (segWidth <= avail) {
                      // Fits entirely on current line
                      writeOut(remaining, out)
                      thinkCol += segWidth
                      remaining = ''
                    } else if (avail <= 0) {
                      // Current line is full, wrap to next
                      writeOut(`${RS}\n`, out)
                      writeOut(`  ${GY}│${RS}${TH}`, out)
                      thinkCol = 0
                    } else {
                      // Write first part that fits, then wrap
                      // Find character boundary that fits within avail
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
                  // Has newline — process the segment up to newline
                  const segment = remaining.slice(0, nlIdx)
                  const segWidth = visibleWidth(segment)
                  const avail = maxContentWidth - thinkCol
                  if (segWidth <= avail) {
                    // Segment fits on current line
                    writeOut(segment, out)
                    writeOut(`${RS}\n`, out)
                    reasoningLineStart = true
                    thinkCol = 0
                  } else {
                    // Segment too long — write what fits, wrap, then rest
                    let rest = segment
                    // Write remainder of current line
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
                    // Write rest of segment on continuation line(s)
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
            this.turnInputTokens += chunk.usage.input_tokens
            this.turnOutputTokens += chunk.usage.output_tokens
            this.totalInputTokens += chunk.usage.input_tokens
            this.totalOutputTokens += chunk.usage.output_tokens
          }
          if (chunk.finish_reason === 'stop' || chunk.finish_reason === 'end_turn') {
            if (toolCalls.length === 0) {
              printTokenStats(
                this.turnInputTokens,
                this.turnOutputTokens,
                this.totalInputTokens,
                this.totalOutputTokens,
                this.turnApiCalls,
                this.totalApiCalls,
                out,
              )
              writeOut('\n\n', out)
              saveTokenUsage(
                this.config.cwd,
                this.turnInputTokens,
                this.turnOutputTokens,
                this.turnApiCalls,
              )
              bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: 0 })
              this.save()
              return
            }
          }
        }
      }

      bus.emit(EventChannels.LLM_STREAM_END, {
        iteration: iterations,
        toolCallCount: toolCalls.length,
      })

      // Close reasoning display if still open (model ended with tool calls, no text)
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
          printTokenStats(
            this.turnInputTokens,
            this.turnOutputTokens,
            this.totalInputTokens,
            this.totalOutputTokens,
            this.turnApiCalls,
            this.totalApiCalls,
            out,
          )
          writeOut('\n\n', out)
        }
        saveTokenUsage(
          this.config.cwd,
          this.turnInputTokens,
          this.turnOutputTokens,
          this.turnApiCalls,
        )
        bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: 0 })
        this.save()
        return
      }

      const assistantMsg: LLMMessage = {
        role: 'assistant',
        content: fullResponse || null,
        tool_calls: toolCalls,
        reasoning_content: reasoningContent,
      }
      this.messages.push(assistantMsg)

      // ── User confirmation for write-type tool calls ──
      if (!this.config.autoApprove && this.output?.confirmTool && toolCalls.length > 0) {
        const writeTools = ['edit', 'bash', 'write_plan', 'exec', 'install_skill']
        const needsConfirm = toolCalls.filter(tc => writeTools.includes(tc.name))
        if (needsConfirm.length > 0) {
          const approved = await this.output.confirmTool(needsConfirm)
          if (!approved) {
            const rejectMsg: LLMMessage = {
              role: 'tool',
              content:
                'USER_REJECTED: The user declined to execute the requested tool calls. Try a different approach.',
              tool_call_id: needsConfirm[0].id,
              name: 'user_feedback',
            }
            this.messages.push(rejectMsg)
            bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
            continue
          }
        }
      }

      for (const tc of toolCalls) {
        // Check if stop was requested after each tool call
        if (this.isStopped()) {
          bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })
          this.save()
          return
        }
        bus.emit(EventChannels.TOOL_CALL, { name: tc.name, input: tc.input, id: tc.id })
        if (!out?.suppressToolOutput) {
          printToolInvocation(tc, out)
        }
        const result: ToolResult = await this.registry.dispatch(tc)
        if (result.success) {
          bus.emit(EventChannels.TOOL_RESULT, { name: tc.name, id: tc.id, output: result.output })
        } else {
          bus.emit(EventChannels.TOOL_ERROR, { name: tc.name, id: tc.id, error: result.error })
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
        this.messages.push(resultMsg)
      }

      // End the current turn before next iteration — frontend creates a new message
      bus.emit(EventChannels.TURN_END, { iterations, toolCallCount: toolCalls.length })

      // Check if compaction is needed
      if (shouldCompact(this.messages)) {
        const before = this.messages.length
        const result = compact(this.messages)
        if (result.compressed) {
          this.messages = result.messages
          bus.emit(EventChannels.COMPACTION_TRIGGERED, { before, after: result.newCount })
          if (out && !out.suppressToolOutput) {
            out.write(
              `\n  ${GY}┃${RS} ${GY}📦 Compressed context: ${before} → ${result.newCount} messages${RS}\n`,
            )
          }
        }
      }
    }

    if (iterations >= maxIterations) {
      printTokenStats(
        this.turnInputTokens,
        this.turnOutputTokens,
        this.totalInputTokens,
        this.totalOutputTokens,
        this.turnApiCalls,
        this.totalApiCalls,
        out,
      )
      writeOut('\nAgent reached maximum iterations. Stopping.\n', out)
    }

    saveTokenUsage(this.config.cwd, this.turnInputTokens, this.turnOutputTokens, this.turnApiCalls)
    this.save()
  }
}
