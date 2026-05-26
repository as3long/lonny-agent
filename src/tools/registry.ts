import { Tool, ToolDefinition, ToolCall, ToolResult } from './types.js'
import { createReadTool } from './read.js'
import { createGrepTool } from './grep.js'
import { createLsTool } from './ls.js'
import { bashTool } from './bash.js'
import { createBatchEditTool } from './batch_edit.js'
import { globTool } from './glob.js'
import { PatchApplier } from '../diff/apply.js'

export interface ToolContext {
  cwd: string
  autoApprove: boolean
  applier: PatchApplier
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  constructor(context: ToolContext) {
    this.register(createReadTool(context.applier, context.cwd))
    this.register(globTool)
    this.register(createGrepTool(context.cwd))
    this.register(createLsTool(context.cwd))
    this.register(bashTool)
    this.register(createBatchEditTool(context.applier, context.cwd, context.autoApprove))
  }

  private register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
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
        error: `Tool "${call.name}" threw: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }
}