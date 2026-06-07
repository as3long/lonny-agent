import type { ToolCall, ToolDefinition } from '../tools/types.js'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  tool_calls?: ToolCall[]
  name?: string
  reasoning_content?: string
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<LLMChunk>
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  /** DeepSeek-specific: tokens read from cache */
  prompt_cache_hit_tokens?: number
  /** DeepSeek-specific: tokens not in cache */
  prompt_cache_miss_tokens?: number
}

export interface LLMChunk {
  type: 'text' | 'tool_use' | 'complete'
  text?: string
  tool_call?: ToolCall
  finish_reason?: string
  reasoning_content?: string
  usage?: TokenUsage
}
