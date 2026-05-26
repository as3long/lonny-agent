import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { createHash } from 'node:crypto'
import { LLMProvider, LLMMessage } from './llm.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { ToolRegistry } from '../tools/registry.js'
import { ToolCall, ToolResult } from '../tools/types.js'
import { FileReadTracker } from '../diff/apply.js'
import { Config } from '../config/index.js'
import { saveTokenUsage } from '../config/tokens.js'

// ── Session persistence ────────────────────────────────────────────────────

interface SessionData {
  cwd: string
  messages: LLMMessage[]
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  mode: 'code' | 'plan'
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

export interface SessionOutput {
  write: (text: string) => void
}

function writeOut(text: string, output?: SessionOutput): void {
  if (output) {
    output.write(text)
  } else {
    process.stdout.write(text)
  }
}

function printUserMessage(prompt: string, output?: SessionOutput): void {
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
        if (l.trim()) writeOut(`  ${GY}│${RS}    ${GY}${l.trim()}${RS}\n`, output)
      }
    }
  } else if (tc.name === 'write_plan') {
    writeOut(`  ${GY}│${RS}  ${GR}✔${RS} ${result.output || tc.name}\n`, output)
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
  return typeof v === 'object' && v !== null && 'file_path' in v && 'old_string' in v && 'new_string' in v
}

function formatToolInput(tc: ToolCall): string {
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
    parts.push(cmd.length > 80 ? cmd.slice(0, 80) + '\u2026' : cmd)
  } else if (tc.name === 'write_plan') {
    if (typeof tc.input.filename === 'string') parts.push(tc.input.filename)
  } else if (tc.name === 'edit') {
    if (Array.isArray(tc.input.edits) && tc.input.edits.every(isSingleEditShape)) {
      const paths = tc.input.edits.map(e => e.file_path)
      parts.push(paths.join(', '))
    } else if (typeof tc.input.file_path === 'string') {
      parts.push(tc.input.file_path)
    }
  }
  return parts.join(' \u2502 ')
}

function printTokenStats(turnIn: number, turnOut: number, totalIn: number, totalOut: number, turnApi: number, totalApi: number, output?: SessionOutput): void {
  const total = totalIn + totalOut
  const msg = `  ${GY}┃${RS} ${GY}${BLD}▴${RS}${GY}${turnIn}${RS} ${GY}${BLD}▾${RS}${GY}${turnOut}${RS}  ${GY}total${RS} ${total}  ${GY}calls${RS} ${turnApi}(${totalApi})`
  writeOut(`\n${msg}\n`, output)
}

function buildSystemPrompt(config: Config): string {
  const platform = os.platform()
  const release = os.release()
  const shell = process.env.SHELL || process.env.ComSpec || 'unknown'
  const arch = os.arch()
  const cwd = config.cwd
  const isWindows = platform === 'win32'

  if (config.mode === 'plan') {
    return `You are a planning agent. Your sole job is to investigate the codebase and produce an actionable implementation plan plus a todo list. You NEVER edit source files.

Environment:
- Platform: ${platform} ${release} (${arch})
- Working directory: ${cwd}
- OS: ${isWindows ? 'Windows' : 'Linux/macOS'}
- Available shell commands: ${isWindows ? 'PowerShell (cmd is also available but PowerShell is preferred)' : 'bash'}
${isWindows ? '- CRITICAL: Use ONLY Windows commands (PowerShell/cmd) in the \`bash\` tool. Do NOT use Unix/Linux commands like \`cat\`, \`ls\`, \`grep\`, \`which\`, \`chmod\`, \`mv\`, \`cp\`, \`rm\`, \`touch\`, \`mkdir\`, \`uname\`, etc.' : ''}
${isWindows ? '  - Use \`type\` instead of \`cat\`, \`dir\` instead of \`ls\`, \`where\` instead of \`which\`' : ''}

RULES:
1. Read first: Use read/grep/glob tools to gather all context you need before planning.
2. Be thorough: Explore the relevant parts of the codebase so the plan is concrete and grounded in real file paths and symbols.
3. You CANNOT edit source files — you have no code edit tools. Only read and analyze.
4. Use \`bash\` for read-only commands only (e.g. listing files, checking git status).
5. ALWAYS persist the final plan to the \`.lonny/\` folder using the \`write_plan\` tool. Pass only a filename (e.g. \`plan.md\` or \`add-auth/plan.md\`); the tool stores it under \`.lonny/\` automatically.
6. COST OPTIMIZATION (CRITICAL): Each API call costs money. Batch multiple reads into one \`read\` call (paths: [...]). Gather ALL context in as few calls as possible.

OUTPUT FORMAT (always respond in this structure once you have enough context):

## Plan
A short, ordered description of the approach. Reference concrete files using \`path:line\` where helpful. Call out risks, edge cases, and assumptions.

## Todo List
- [ ] Step 1 — concrete action (file or area affected)
- [ ] Step 2 — concrete action
- [ ] ...

After producing the Plan + Todo List, call \`write_plan\` to save the exact same markdown into \`.lonny/<name>.md\`. Choose a short, descriptive filename based on the task.

## Next
End your response by telling the user where the plan was saved and asking whether they want to switch to \`code\` mode to execute it. Use exactly this prompt on its own line:
"Switch to code mode to implement this plan? (run \`/mode code\`)"

If the user's request is a question rather than a change request, answer it directly and skip the write_plan call, Todo List, and Next sections.

Available tools:
- \`read\`: Read file contents (paths: string[])
- \`glob\`: Find files by glob pattern (pattern: string)
- \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
- \`ls\`: List directory (path?: string)
- \`bash\`: Execute a shell command (command: string, description?: string, timeout?: number)
- \`write_plan\`: Save the plan markdown into the \`.lonny/\` folder (filename: string, content: string)`
  }

  return `You are a coding agent optimized for per-call pricing.

Environment:
- Platform: ${platform} ${release} (${arch})
- Shell: ${shell}
- Working directory: ${cwd}
- OS: ${isWindows ? 'Windows' : 'Linux/macOS'}
- Available shell commands: ${isWindows ? 'PowerShell (cmd is also available but PowerShell is preferred)' : 'bash'}
${isWindows ? '- CRITICAL: Use ONLY Windows commands (PowerShell/cmd) in the \`bash\` tool. Do NOT use Unix/Linux commands like \`cat\`, \`ls\`, \`grep\`, \`which\`, \`chmod\`, \`mv\`, \`cp\`, \`rm\`, \`touch\`, \`mkdir\`, \`uname\`, etc.' : ''}
${isWindows ? '  - Use \`type\` instead of \`cat\`, \`dir\` instead of \`ls\`, \`where\` instead of \`which\`' : ''}

RULES:
1. Read first: Use read/grep/glob tools to gather all context you need BEFORE making any edits. The \`read\` output prefixes each line with "<lineNumber>: " for easy reference. Do NOT include the "N: " prefix when copying text into \`edit\`.
2. Use \`edit\` for file changes (single or batch via \`edits\` array). \`bash\` can also create and edit files, but \`edit\` is preferred for structured changes.
3. After making edits to a file, if you need to make ANOTHER edit to the SAME file, you MUST re-read it first to get the updated content. The old_string from your previous read is stale and will cause \`old_string not found\`.
4. If \`edit\` reports \`old_string not found\`, do NOT retry with the same old_string — re-read the file immediately to see its actual current content, then retry with correctly-copied text.
5. When copying old_string from \`read\` output, include 2-3 lines of context BEFORE and AFTER the target change to make the string unique in the file.
6. On Windows, files may use CRLF (\r\n) line endings, but the \`edit\` tool normalizes them to LF (\n). Always use \`\n\` (not \`\r\n\`) in old_string/new_string.
7. Prefer batch edits (\`edits: [...]\`) over single edits when modifying multiple spots in the same file — the tool processes them in reverse order so positions stay valid.
8. COST OPTIMIZATION (CRITICAL): Each API call costs money. You have a hard limit of ~5 API calls per task. You MUST maximize work per call. Use \`read(paths: [...])\` to read multiple files at once. Use \`edit(edits: [...])\` to edit multiple files at once. Output MULTIPLE tool_use blocks in a single response when they are independent. Do NOT do sequential single-file reads or single-edit calls — that wastes your budget.

Available tools:
- \`read\`: Read file contents (paths: string[])
- \`glob\`: Find files by glob pattern (pattern: string)
- \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
- \`ls\`: List directory (path?: string)
- \`bash\`: Execute a shell command (command: string, description?: string, timeout?: number)
- \`edit\`: Replace exact text in files — single (file_path+old_string+new_string) or batch (edits:[...])`
}

export class Session {
  messages: LLMMessage[]
  provider: LLMProvider
  registry: ToolRegistry
  applier: FileReadTracker
  config: Config
  output?: SessionOutput
  totalInputTokens: number = 0
  totalOutputTokens: number = 0
  turnInputTokens: number = 0
  turnOutputTokens: number = 0
  turnApiCalls: number = 0
  totalApiCalls: number = 0

  constructor(config: Config, output?: SessionOutput) {
    this.config = config
    this.output = output
    this.applier = new FileReadTracker()
    this.registry = new ToolRegistry({
      cwd: config.cwd,
      autoApprove: config.autoApprove,
      applier: this.applier,
      mode: config.mode,
    })

    if (config.provider === 'openai') {
      this.provider = new OpenAIProvider(config.apiKey, config.baseUrl, config.model, config.thinking, config.reasoningEffort)
    } else {
      this.provider = new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
    }

    this.messages = [
      { role: 'system', content: buildSystemPrompt(config) },
    ]
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
    // Refresh the system prompt in case config changed (e.g. model)
    session.messages[0] = { role: 'system', content: buildSystemPrompt(config) }
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

  setMode(mode: 'code' | 'plan'): void {
    this.config.mode = mode
    this.messages[0] = { role: 'system', content: buildSystemPrompt(this.config) }
    this.registry.setMode(mode)
  }

  async chat(userPrompt: string): Promise<void> {
    const out = this.output
    printUserMessage(userPrompt, out)
    this.messages.push({ role: 'user', content: userPrompt })

    // Reset per-turn counters
    this.turnInputTokens = 0
    this.turnOutputTokens = 0
    this.turnApiCalls = 0

    let iterations = 0
    const maxIterations = 8

    while (iterations < maxIterations) {
      iterations++
      this.turnApiCalls++
      this.totalApiCalls++
      const toolCalls: ToolCall[] = []
      let fullResponse = ''
      let reasoningContent: string | undefined

      const stream = this.provider.chat(this.messages, this.registry.getDefinitions())

      for await (const chunk of stream) {
        if (chunk.reasoning_content) {
          reasoningContent = chunk.reasoning_content
        }
        if (chunk.type === 'text' && chunk.text) {
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
              printTokenStats(this.turnInputTokens, this.turnOutputTokens, this.totalInputTokens, this.totalOutputTokens, this.turnApiCalls, this.totalApiCalls, out)
              writeOut('\n\n', out)
              saveTokenUsage(this.config.cwd, this.turnInputTokens, this.turnOutputTokens, this.turnApiCalls)
              this.save()
              return
            }
          }
        }
      }

      if (toolCalls.length === 0) {
        if (fullResponse) {
          printTokenStats(this.turnInputTokens, this.turnOutputTokens, this.totalInputTokens, this.totalOutputTokens, this.turnApiCalls, this.totalApiCalls, out)
          writeOut('\n\n', out)
        }
        saveTokenUsage(this.config.cwd, this.turnInputTokens, this.turnOutputTokens, this.turnApiCalls)
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

      for (const tc of toolCalls) {
        printToolInvocation(tc, out)
        const result: ToolResult = await this.registry.dispatch(tc)
        printToolResult(tc, result, out)

        const resultMsg: LLMMessage = {
          role: 'tool',
          content: result.success ? result.output : `ERROR: ${result.error}`,
          tool_call_id: tc.id,
          name: tc.name,
        }
        this.messages.push(resultMsg)
      }
    }

    if (iterations >= maxIterations) {
      printTokenStats(this.turnInputTokens, this.turnOutputTokens, this.totalInputTokens, this.totalOutputTokens, this.turnApiCalls, this.totalApiCalls, out)
      writeOut('\nAgent reached maximum iterations. Stopping.\n', out)
    }

    saveTokenUsage(this.config.cwd, this.turnInputTokens, this.turnOutputTokens, this.turnApiCalls)
    this.save()
  }
}
