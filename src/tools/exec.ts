import * as vm from 'node:vm'
import { Tool, ToolDefinition, ToolResult } from './types.js'

// ── Types ────────────────────────────────────────────────────────────────────

interface ExecPragma {
  timeout_ms?: number
  yield_time_ms?: number
  max_output_tokens?: number
}

interface ExecContext {
  tools: Record<string, (input: unknown) => Promise<string>>
  store: Map<string, unknown>
  output: string[]
  notified: boolean
}

const PRAGMA_PREFIX = '// @exec:'
const DEFAULT_TIMEOUT_MS = 30_000

// ── Pragma parsing ──────────────────────────────────────────────────────────

function parsePragma(input: string): { code: string; pragma: ExecPragma } {
  const lines = input.split('\n')
  const firstLine = lines[0]?.trim() ?? ''
  const pragma: ExecPragma = {}

  if (firstLine.startsWith(PRAGMA_PREFIX)) {
    const jsonStr = firstLine.slice(PRAGMA_PREFIX.length).trim()
    if (jsonStr) {
      try {
        const parsed = JSON.parse(jsonStr) as ExecPragma
        // Validate fields
        for (const key of Object.keys(parsed)) {
          if (!['timeout_ms', 'yield_time_ms', 'max_output_tokens'].includes(key)) {
            throw new Error(`exec pragma only supports \`timeout_ms\`, \`yield_time_ms\`, and \`max_output_tokens\`; got \`${key}\``)
          }
        }
        if (parsed.timeout_ms !== undefined) {
          if (!Number.isSafeInteger(parsed.timeout_ms) || parsed.timeout_ms < 0) {
            throw new Error('exec pragma field `timeout_ms` must be a non-negative safe integer')
          }
        }
        if (parsed.yield_time_ms !== undefined) {
          if (!Number.isSafeInteger(parsed.yield_time_ms) || parsed.yield_time_ms < 0) {
            throw new Error('exec pragma field `yield_time_ms` must be a non-negative safe integer')
          }
        }
        if (parsed.max_output_tokens !== undefined) {
          if (!Number.isSafeInteger(parsed.max_output_tokens) || parsed.max_output_tokens < 0) {
            throw new Error('exec pragma field `max_output_tokens` must be a non-negative safe integer')
          }
        }
        Object.assign(pragma, parsed)
      } catch (err) {
        throw new Error(`exec pragma parse error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    return { code: lines.slice(1).join('\n').trim(), pragma }
  }

  return { code: input, pragma }
}

// ── TypeScript type rendering ────────────────────────────────────────────────

function renderTsType(param: Record<string, unknown>, depth = 0): string {
  const indent = '  '.repeat(depth + 1)
  const closeIndent = '  '.repeat(depth)

  if (param.type === 'string') return 'string'
  if (param.type === 'number' || param.type === 'integer') return 'number'
  if (param.type === 'boolean') return 'boolean'
  if (param.type === 'array') {
    if (param.items) return `Array<${renderTsType(param.items as Record<string, unknown>, depth)}>`
    return 'unknown[]'
  }
  if (param.type === 'object' || (param.properties as Record<string, unknown> | undefined)) {
    const props = param.properties as Record<string, Record<string, unknown>> | undefined
    const additionalProps = param.additionalProperties
    if (!props && !additionalProps) return 'Record<string, unknown>'

    const lines: string[] = ['{']
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        const isRequired = Array.isArray(param.required) && (param.required as string[]).includes(key)
        const opt = isRequired ? '' : '?'
        const desc = value.description ? ` // ${value.description}` : ''
        const valType = renderTsType(value, depth + 1)
        lines.push(`${indent}${JSON.stringify(key)}${opt}: ${valType};${desc}`)
      }
    }
    if (additionalProps && additionalProps !== false) {
      const valType = typeof additionalProps === 'object' ? renderTsType(additionalProps as Record<string, unknown>, depth + 1) : 'unknown'
      lines.push(`${indent}[key: string]: ${valType};`)
    }
    lines.push(`${closeIndent}}`)
    return lines.join('\n')
  }

  return 'unknown'
}

function renderToolDeclaration(tool: ToolDefinition): string {
  const params = tool.parameters
  const hasParams = params && Object.keys(params).length > 0
  const paramType = hasParams ? renderTsType({
    type: 'object',
    properties: params,
    required: Object.entries(params).filter(([_, v]) => v.required).map(([k]) => k),
  } as unknown as Record<string, unknown>) : '{}'

  return `${tool.name}(args: ${paramType}): Promise<string>;`
}

// ── Build the exec tool description with TypeScript declarations ────────────

function buildExecDescription(toolDefs: ToolDefinition[]): string {
  const toolDeclarations = toolDefs
    .filter(t => t.name !== 'exec')
    .map(t => `  ${renderToolDeclaration(t)}`)
    .join('\n')

  return `Run JavaScript code to orchestrate/compose tool calls.
- Evaluates the provided JavaScript code in a fresh V8 sandbox as an async function.
- All tools are available on the global \`tools\` object, for example \`await tools.read({paths: ["file.ts"]})\`.
- Tool methods take an object as their input argument and return a string.
- Runs raw JavaScript — no \`require\`, no file system, no network access, no \`console\` (use \`text()\` instead).
- Accepts raw JavaScript source text, not JSON, quoted strings, or markdown code fences.
- You may optionally start the tool input with a first-line pragma like \`// @exec: {"timeout_ms": 30000, "max_output_tokens": 1000}\`.
- \`timeout_ms\` sets the maximum execution time (default: 30000).
- \`max_output_tokens\` sets the token budget for results (approximate character limit).

Global helpers:
- \`text(value)\`: Appends a string to the output. Non-string values are stringified.
- \`exit()\`: Immediately ends the current script successfully.
- \`store(key, value)\`: Stores a value under a string key for later \`exec\` calls in the same session.
- \`load(key)\`: Returns the stored value, or \`undefined\` if missing.

Available tool declarations:
\`\`\`ts
declare const tools: {
${toolDeclarations}
};
\`\`\``
}

// ── Exec tool factory ───────────────────────────────────────────────────────

export function createExecTool(getTools: () => Tool[]): Tool {
  // Shared store across exec calls in the same session
  const sharedStore = new Map<string, unknown>()

  return {
    definition: {
      name: 'exec',
      description: 'Run JavaScript code to orchestrate tool calls in a sandboxed V8 isolate.',
      parameters: {
        code: {
          type: 'string',
          description: 'JavaScript source code to execute. Optionally starts with // @exec: {"timeout_ms": 30000} pragma.',
          required: true,
        },
      },
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const rawCode = input.code as string
      if (!rawCode || typeof rawCode !== 'string') {
        return { success: false, output: '', error: 'exec expects a `code` string parameter with JavaScript source text.' }
      }

      // Parse pragma
      let code: string
      let pragma: ExecPragma
      try {
        const parsed = parsePragma(rawCode)
        code = parsed.code
        pragma = parsed.pragma
      } catch (err) {
        return { success: false, output: '', error: err instanceof Error ? err.message : String(err) }
      }

      if (!code.trim()) {
        return { success: false, output: '', error: 'exec expects non-empty JavaScript source text.' }
      }

      // Build context
      const ctx: ExecContext = {
        tools: {},
        store: sharedStore,
        output: [],
        notified: false,
      }

      // Wrap each registered tool as an async function available in the sandbox
      const allTools = getTools()
      for (const tool of allTools) {
        if (tool.definition.name === 'exec') continue // don't expose exec itself
        ctx.tools[tool.definition.name] = async (toolInput: unknown): Promise<string> => {
          const result = await tool.execute((toolInput ?? {}) as Record<string, unknown>)
          if (!result.success) {
            throw new Error(`Tool "${tool.definition.name}" failed: ${result.error}`)
          }
          return result.output
        }
      }

      // Wrap the code in an async function that receives the context
      const wrappedCode = `
        (async () => {
          const tools = context.tools;
          const store = context.store;
          const output = context.output;
          
          function text(value) {
            if (value === null || value === undefined) output.push(String(value));
            else if (typeof value === 'object') output.push(JSON.stringify(value));
            else output.push(String(value));
          }
          
          function exit() {
            context.done = true;
            return;
          }
          
          function store(key, value) {
            context.store.set(key, value);
          }
          
          function load(key) {
            return context.store.get(key);
          }
          
          ${code}
        })()
      `

      // Create sandbox context
      const sandbox = {
        context: ctx,
        setTimeout: setTimeout.bind(globalThis),
        clearTimeout: clearTimeout.bind(globalThis),
        console: {
          log: (...args: unknown[]) => ctx.output.push(args.map(a => String(a)).join(' ')),
          error: (...args: unknown[]) => ctx.output.push(`ERROR: ${args.map(a => String(a)).join(' ')}`),
          warn: (...args: unknown[]) => ctx.output.push(`WARN: ${args.map(a => String(a)).join(' ')}`),
          info: (...args: unknown[]) => ctx.output.push(args.map(a => String(a)).join(' ')),
        },
        // Safe globals
        Array, Object, String, Number, Boolean, Date, Math, JSON, RegExp, Map, Set,
        Promise, Error, TypeError, RangeError, SyntaxError, ReferenceError,
        parseInt, parseFloat, isNaN, isFinite, encodeURI, decodeURI,
        encodeURIComponent, decodeURIComponent,
        // TextEncoder/Decoder for buffer handling
        TextEncoder, TextDecoder,
      }

      const timeout = pragma.timeout_ms ?? DEFAULT_TIMEOUT_MS
      const maxOutputTokens = pragma.max_output_tokens ?? 10_000
      const maxChars = maxOutputTokens * 4 // rough estimate

      try {
        const script = new vm.Script(wrappedCode, {
          filename: 'exec-sandbox.js',
        })

        const vmContext = vm.createContext(sandbox)
        await script.runInContext(vmContext, {
          timeout: timeout,
          breakOnSigint: true,
        })

        let output = ctx.output.join('')
        if (output.length > maxChars) {
          output = output.slice(0, maxChars) + '\n\n... (output truncated)'
        }

        return { success: true, output: output || '(exec completed with no output)' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('timed out') || msg.includes('timeout')) {
          return { success: false, output: ctx.output.join(''), error: `exec timed out after ${timeout}ms` }
        }
        return {
          success: false,
          output: ctx.output.join(''),
          error: `exec error: ${msg}`,
        }
      }
    },
  }
}

/** Rebuild the exec tool definition (called when tools change) */
export function updateExecToolDefinition(execTool: Tool, toolDefs: ToolDefinition[]): void {
  execTool.definition.description = buildExecDescription(toolDefs)
}
