export interface ToolParameter {
  type: string
  description?: string
  required?: boolean
  [key: string]: unknown
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  /** Top-level category used for hierarchical tool trees, e.g. "File I/O". */
  category?: string
  /** Second-level group used for hierarchical tool trees, e.g. "Read". */
  group?: string
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
}

export interface Tool {
  definition: ToolDefinition
  execute(input: Record<string, unknown>): Promise<ToolResult>
}

export interface ToolTreeNode {
  type: 'group' | 'tool'
  name: string
  description?: string
  children?: ToolTreeNode[]
  toolName?: string
  depth: number
}
