import { LLMProvider, LLMMessage } from './llm.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { ToolRegistry } from '../tools/registry.js'
import { ToolCall, ToolResult } from '../tools/types.js'
import { PatchApplier } from '../diff/apply.js'
import { Config } from '../config/index.js'
import * as os from 'node:os'

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const RE = '\x1b[31m'
const MG = '\x1b[35m'
const GY = '\x1b[90m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'

function printUserMessage(prompt: string): void {
  const line = `  ${GY}┃${RS} ${BLD}${CY}You${RS}`
  process.stdout.write(`\n${line}  ${prompt}\n\n`)
}

function printToolInvocation(tc: ToolCall): void {
  const detail = formatToolInput(tc)
  const isWrite = tc.name === 'write_plan' || tc.name === 'edit'
  const icon = isWrite ? `${YE}◆${RS}` : `${GR}◇${RS}`
  const label = isWrite ? `${YE}${tc.name}${RS}` : `${GR}${tc.name}${RS}`
  console.error(`  ${GY}│${RS}  ${icon} ${label}${detail ? ` ${GY}${detail}${RS}` : ''}`)
}

function printToolResult(tc: ToolCall, result: ToolResult): void {
  if (!result.success) {
    console.error(`  ${GY}│${RS}  ${RE}✖${RS} ${RE}${result.error}${RS}`)
    return
  }
  if (tc.name === 'read') {
    const fileCount = (result.output.match(/^=== /gm) || []).length
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} read ${fileCount} file(s)`)
    for (const line of result.output.split('\n')) {
      if (line.startsWith('=== ')) {
        const fp = line.slice(4, line.includes(' ===') ? line.indexOf(' ===') + 4 : undefined)
        console.error(`  ${GY}│${RS}    ${GY}${fp}${RS}`)
      }
    }
  } else if (tc.name === 'glob') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} glob ${count} match(es)`)
  } else if (tc.name === 'grep') {
    const count = result.output.split('\n').filter(l => l && !l.startsWith('No')).length
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} grep ${count} match(es)`)
  } else if (tc.name === 'bash') {
    const outLines = result.output.split('\n')
    const summary = outLines.length > 1 ? `(${outLines.length} lines)` : ''
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} bash ${summary}`)
  } else if (tc.name === 'edit') {
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} edit`)
    if (result.output) {
      for (const l of result.output.split('\n')) {
        if (l.trim()) console.error(`  ${GY}│${RS}    ${GY}${l.trim()}${RS}`)
      }
    }
  } else if (tc.name === 'write_plan') {
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} ${result.output || tc.name}`)
  } else {
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} ${tc.name}`)
  }
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
    parts.push(cmd.length > 80 ? cmd.slice(0, 80) + '…' : cmd)
  } else if (tc.name === 'write_plan') {
    if (typeof tc.input.filename === 'string') parts.push(tc.input.filename)
  } else if (tc.name === 'edit') {
    if (Array.isArray(tc.input.edits)) {
      const paths = (tc.input.edits as Array<Record<string, unknown>>).map(e => e.file_path)
      parts.push(paths.join(', '))
    } else if (typeof tc.input.file_path === 'string') {
      parts.push(tc.input.file_path)
    }
  }
  return parts.join(' │ ')
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
- Use ${isWindows ? 'PowerShell/cmd' : 'bash'} commands for the \`bash\` tool.
  ${isWindows ? 'Use \`type\` instead of \`cat\`, \`dir\` instead of \`ls\`.' : ''}

RULES:
1. Read first: Use read/grep/glob tools to gather all context you need before planning.
2. Be thorough: Explore the relevant parts of the codebase so the plan is concrete and grounded in real file paths and symbols.
3. You CANNOT edit source files — you have no code edit tools. Only read and analyze.
4. Use \`bash\` for read-only commands only (e.g. listing files, checking git status).
5. ALWAYS persist the final plan to the \`.lonny/\` folder using the \`write_plan\` tool. Pass only a filename (e.g. \`plan.md\` or \`add-auth/plan.md\`); the tool stores it under \`.lonny/\` automatically.

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
- \`bash\`: Execute a read-only shell command (command: string, description?: string, timeout?: number)
- \`write_plan\`: Save the plan markdown into the \`.lonny/\` folder (filename: string, content: string)`
  }

  return `You are a coding agent optimized for per-call pricing.

Environment:
- Platform: ${platform} ${release} (${arch})
- Shell: ${shell}
- Working directory: ${cwd}
- Use ${isWindows ? 'PowerShell/cmd' : 'bash'} commands for the \`bash\` tool.
  ${isWindows ? 'Use `type` instead of `cat`, `dir` instead of `ls`, `echo` for file creation with `>` redirection.' : ''}

RULES:
1. Read first: Use read/grep/glob tools to gather all context you need BEFORE making any edits. The \`read\` output prefixes each line with "<lineNumber>: " for easy reference. Do NOT include the "N: " prefix when copying text into \`edit\`.
2. Use \`edit\` for ALL file changes (single or batch). For multiple changes, pass an \`edits\` array — this reduces API calls. \`edit\` uses exact string matching (no line numbers, no hunk headers). For creating or deleting files, use \`bash\`.
3. After applying changes, if more work is needed, continue with Phase 1 (reading) again.

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
  applier: PatchApplier
  config: Config

  constructor(config: Config) {
    this.config = config
    this.applier = new PatchApplier()
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

  setMode(mode: 'code' | 'plan'): void {
    this.config.mode = mode
    this.messages[0] = { role: 'system', content: buildSystemPrompt(this.config) }
    this.registry.setMode(mode)
  }

  async chat(userPrompt: string): Promise<void> {
    printUserMessage(userPrompt)
    this.messages.push({ role: 'user', content: userPrompt })

    let iterations = 0
    const maxIterations = 50

    while (iterations < maxIterations) {
      iterations++
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
          process.stdout.write(chunk.text)
        } else if (chunk.type === 'tool_use' && chunk.tool_call) {
          toolCalls.push(chunk.tool_call)
        } else if (chunk.type === 'complete') {
          if (chunk.finish_reason === 'stop' || chunk.finish_reason === 'end_turn') {
            if (toolCalls.length === 0) {
              process.stdout.write('\n\n')
              return
            }
          }
        }
      }

      if (toolCalls.length === 0) {
        if (fullResponse) {
          process.stdout.write('\n\n')
        }
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
        printToolInvocation(tc)
        const result: ToolResult = await this.registry.dispatch(tc)
        printToolResult(tc, result)

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
      console.error('\nAgent reached maximum iterations. Stopping.')
    }
  }
}