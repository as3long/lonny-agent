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