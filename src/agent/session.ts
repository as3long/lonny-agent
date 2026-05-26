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
  const icon = tc.name === 'batch_edit' ? `${YE}◆${RS}` : `${GR}◇${RS}`
  const label = tc.name === 'batch_edit' ? `${YE}batch_edit${RS}` : `${GR}${tc.name}${RS}`
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
  } else if (tc.name === 'batch_edit') {
    console.error(`  ${GY}│${RS}  ${GR}✔${RS} batch_edit`)
    if (result.output) {
      for (const l of result.output.split('\n')) {
        if (l.trim()) console.error(`  ${GY}│${RS}    ${GY}${l.trim()}${RS}`)
      }
    }
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
  } else if (tc.name === 'batch_edit') {
    const text = typeof tc.input.patch_text === 'string' ? tc.input.patch_text : ''
    const lines = text.split('\n').filter(l => l.startsWith('@'))
    parts.push(lines.join(', '))
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

  return `You are a coding agent optimized for per-call pricing.

Environment:
- Platform: ${platform} ${release} (${arch})
- Shell: ${shell}
- Working directory: ${cwd}
- Use ${isWindows ? 'PowerShell/cmd' : 'bash'} commands for the \`bash\` tool.
  ${isWindows ? 'Use `type` instead of `cat`, `dir` instead of `ls`, `echo` for file creation with `>` redirection.' : ''}

RULES:
1. Read first: Use read/grep/glob tools to gather all context you need BEFORE making any edits.
2. Batch all edits: When you are ready to make changes, produce ONE single \`batch_edit\` tool call containing ALL file modifications. Do NOT make multiple small edit calls.
3. The \`batch_edit\` tool accepts a compact diff format that can describe changes to multiple files in one operation. Use it.
4. Each \`batch_edit\` call costs the same as a single edit call, so always prefer ONE batch over many individual edits.
5. After applying the batch, if more work is needed, continue with Phase 1 (reading) again.

Available tools:
- \`read\`: Read file contents (paths: string[])
- \`glob\`: Find files by glob pattern (pattern: string)
- \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
- \`ls\`: List directory (path?: string)
- \`bash\`: Execute a shell command (command: string, description?: string, timeout?: number)
- \`batch_edit\`: Apply ALL file edits at once (patch_text: string)`
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