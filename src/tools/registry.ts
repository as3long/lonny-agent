import { Tool, ToolDefinition, ToolCall, ToolResult } from './types.js'
import { fmtErr } from './errors.js'
import { createReadTool } from './read.js'
import { createGrepTool } from './grep.js'
import { createLsTool } from './ls.js'
import { bashTool } from './bash.js'
import { createEditTool } from './edit.js'
import { createWritePlanTool } from './write_plan.js'
import { globTool } from './glob.js'
import { createFindTool } from './find.js'
import { createGitTool } from './git.js'
import { fetchTool } from './fetch.js'
import { searchTool } from './search.js'
import { createExecTool, updateExecToolDefinition } from './exec.js'
import { FileReadTracker } from '../diff/apply.js'

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
    this.register(bashTool)
    this.register(createFindTool(this.context.cwd))
    this.register(createGitTool(this.context.cwd))
    this.register(fetchTool)
    this.register(searchTool)
    if (this.context.mode === 'code') {
      this.register(createEditTool(this.context.applier, this.context.cwd))
    } else {
      this.register(createWritePlanTool(this.context.cwd, this.context.onPlanWritten))
    }

    // Register exec tool (only in code mode, where multi-step orchestration is useful)
    if (this.context.mode === 'code') {
      this.registerExecTool()
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

    try {
      return await tool.execute(call.input)
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Tool "${call.name}" threw: ${fmtErr(err)}`,
      }
    }
  }
}
