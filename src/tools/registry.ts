import type { FileReadTracker } from '../diff/apply.js'
import { bashTool } from './bash.js'
import { createEditTool } from './edit.js'
import { fmtErr } from './errors.js'
import { createExecTool, updateExecToolDefinition } from './exec.js'
import { fetchTool } from './fetch.js'
import { createFindTool } from './find.js'
import { createGitTool } from './git.js'
import { globTool } from './glob.js'
import { createGrepTool } from './grep.js'
import { createInstallSkillTool } from './install_skill.js'
import { createLsTool } from './ls.js'
import { createReadTool } from './read.js'
import { searchTool } from './search.js'
import type { Tool, ToolCall, ToolDefinition, ToolResult } from './types.js'
import { createWritePlanTool } from './write_plan.js'

/**
 * Normalize tool input to prevent common LLM call misuses.
 * The LLM sometimes passes parameters in the wrong format — this function
 * auto-corrects those patterns so tools work reliably.
 *
 * Common misuses handled:
 * 1. Passed as a string instead of { ... } object wrapper
 * 2. Passed top-level params directly instead of nested in the expected key
 * 3. Array passed directly (for tools that expect { items: [...] })
 */
function normalizeToolInput(
  toolName: string,
  _definition: ToolDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  // If input is a string (e.g. install_skill("package-name") or bash("ls -la"))
  // wrap it into the appropriate key
  if (typeof input === 'string') {
    if (toolName === 'bash' || toolName === 'git') {
      return { command: input }
    }
    if (
      toolName === 'install_skill' ||
      toolName === 'find' ||
      toolName === 'glob' ||
      toolName === 'grep'
    ) {
      return { pattern: input }
    }
    if (toolName === 'search' || toolName === 'fetch') {
      return { query: input, url: input }
    }
    if (toolName === 'write_plan') {
      return { filename: input, content: input }
    }
    if (toolName === 'exec') {
      return { code: input }
    }
    // For tools that take a single string param, guess from the definition
    const params = Object.keys(_definition.parameters)
    if (params.length === 1) {
      return { [params[0]]: input }
    }
    return input
  }

  // If input is an array (e.g. read called with ["file.ts"] directly)
  if (Array.isArray(input)) {
    if (toolName === 'read' || toolName === 'ls') {
      return { paths: input, path: (input as string[])[0] }
    }
    if (toolName === 'edit') {
      return { edits: input }
    }
    return input
  }

  // If edit tool gets an empty object, some models hallucinate the call
  if (toolName === 'edit' && Object.keys(input).length === 0) {
    return { edits: [] }
  }

  return input
}

export interface ToolContext {
  cwd: string
  autoApprove: boolean
  applier: FileReadTracker
  mode: 'code' | 'plan' | 'ask'
  onPlanWritten?: (display: string) => void
}

export interface ToolPlugin {
  name: string
  description: string
  create: (context: ToolContext) => Tool
}

/**
 * Extensible ToolRegistry with plugin support.
 * Inspired by pi's extension system for dynamic tool registration.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private context: ToolContext
  private plugins: Map<string, ToolPlugin> = new Map()
  /** Reference to the exec tool for dynamic description updates */
  private execTool: Tool | null = null

  constructor(context: ToolContext) {
    this.context = context
    this.registerBuiltins()
  }

  /** Register all built-in tools */
  private registerBuiltins(): void {
    // ask mode: only fetch and search + exec (exec works with any toolset)
    if (this.context.mode === 'ask') {
      this.register(fetchTool)
      this.register(searchTool)
      return
    }

    this.register(createReadTool(this.context.applier, this.context.cwd))
    this.register(globTool)
    this.register(createGrepTool(this.context.cwd))
    this.register(createLsTool(this.context.cwd))
    this.register(createFindTool(this.context.cwd))
    this.register(fetchTool)
    this.register(searchTool)

    if (this.context.mode === 'code') {
      // Code mode: full toolset including write operations
      this.register(bashTool)
      this.register(createGitTool(this.context.cwd))
      this.register(createInstallSkillTool(this.context.cwd))
      this.register(createEditTool(this.context.applier, this.context.cwd))
      this.registerExecTool()
    } else {
      // Plan mode: read-only investigation + write_plan
      this.register(createWritePlanTool(this.context.cwd, this.context.onPlanWritten))
    }
  }

  /** Register the exec tool with dynamic type declarations for all registered tools */
  private registerExecTool(): void {
    const execTool = createExecTool(() => Array.from(this.tools.values()))
    this.execTool = execTool
    this.register(execTool)
  }

  /** Refresh the exec tool's description to include current tool type declarations */
  private refreshExecDescription(): void {
    if (this.execTool) {
      updateExecToolDefinition(this.execTool, this.getDefinitions())
    }
  }

  setMode(mode: 'code' | 'plan' | 'ask'): void {
    // Update context.mode FIRST so registerBuiltins() and mode-based logic
    // use the NEW mode, not the stale one (fixes bug when switching from
    // ask→code or plan→code where all tools would be missing)
    this.context.mode = mode

    if (mode === 'code') {
      // Re-register all built-in tools for code mode
      this.tools.clear()
      this.execTool = null
      this.registerBuiltins()
    } else if (mode === 'plan') {
      // Keep existing tools but swap edit/write_plan, remove exec
      if (!this.tools.has('write_plan')) {
        this.register(createWritePlanTool(this.context.cwd, this.context.onPlanWritten))
      }
      this.tools.delete('edit')
      this.tools.delete('exec')
      this.execTool = null
    } else if (mode === 'ask') {
      // Ask mode: only fetch and search
      this.tools.clear()
      this.execTool = null
      this.register(fetchTool)
      this.register(searchTool)
    }
  }

  /** Register a single tool */
  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
    // Refresh exec tool description to include the new tool's type declarations
    if (this.execTool && tool.definition.name !== 'exec') {
      this.refreshExecDescription()
    }
  }

  /** Register a tool plugin (lazy creation pattern) */
  registerPlugin(plugin: ToolPlugin): void {
    this.plugins.set(plugin.name, plugin)
    // Activate immediately
    try {
      const tool = plugin.create(this.context)
      this.register(tool)
    } catch (err) {
      console.error(`Failed to activate plugin "${plugin.name}": ${err}`)
    }
  }

  /** Unregister a tool by name */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /** Check if a tool is registered */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** Re-register write_plan tool with an updated callback */
  reRegisterWritePlan(cwd: string, cb?: (display: string) => void): void {
    this.tools.delete('write_plan')
    this.tools.set('write_plan', createWritePlanTool(cwd, cb))
  }

  /** Partially update the context (used by session.onPlanWritten setter) */
  updateContext(partial: Partial<ToolContext>): void {
    Object.assign(this.context, partial)
  }

  /** List all registered tool names */
  listTools(): string[] {
    return Array.from(this.tools.keys())
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition)
  }

  async dispatch(call: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(call.name)
    if (!tool) {
      return {
        success: false,
        output: '',
        error: `Unknown tool: "${call.name}". Available: ${Array.from(this.tools.keys()).join(', ')}`,
      }
    }

    // ── Universal input normalization ──────────────────────────────────
    // Auto-correct common LLM call misuses before they reach tool execute()
    let input = call.input
    try {
      input = normalizeToolInput(call.name, tool.definition, input)
    } catch {
      // If normalization throws, let the tool handle it (or fail naturally)
    }

    try {
      return await tool.execute(input)
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Tool "${call.name}" threw: ${fmtErr(err)}`,
      }
    }
  }
}
