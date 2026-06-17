import OpenAI from 'openai'
import type { RequestOptions } from 'openai/core.js'
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js'
import type { Stream } from 'openai/streaming.js'
import { ToolCall, type ToolDefinition } from '../../tools/types.js'
import type { LLMChunk, LLMMessage, LLMProvider } from '../llm.js'

// Extended create params for non-standard OpenAI-compatible providers
interface ExtendedCreateParams {
  model: string
  messages: ChatCompletionMessageParam[]
  tools?: ChatCompletionTool[]
  stream: boolean
  stream_options?: { include_usage: boolean }
  thinking?: { type: string }
  reasoning_effort?: string
  enable_cache?: boolean
}

/** Try to parse JSON, and attempt to repair common issues like unescaped quotes */
function tryParseJSON(input: string): Record<string, unknown> | null {
  try {
    return JSON.parse(input)
  } catch {
    // Try to repair common JSON issues from LLM output
    let repaired = input

    // Fix unescaped quotes in string values:
    // Pattern: key="unquoted text" -> key="escaped text"
    // This regex finds ="<not properly escaped>" and adds escaping
    // It handles: ="<content with spaces and 中文">
    repaired = repaired.replace(/= "([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, content) => {
      // Escape any unescaped quotes within the content
      const escaped = content.replace(/(?<!\\)"/g, '\\"')
      return `= "${escaped}"`
    })

    // Also try escaping quotes after @ (for @click="...")
    repaired = repaired.replace(/@(\w+)="([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, attr, content) => {
      const escaped = content.replace(/(?<!\\)"/g, '\\"')
      return `@${attr}="${escaped}"`
    })

    try {
      return JSON.parse(repaired)
    } catch {
      return null
    }
  }
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string
  private baseURL?: string
  private thinking?: boolean
  private reasoningEffort?: string
  private enableCache: boolean
  /** Enable DeepSeek-style strict mode for tool definitions */
  private strictTools: boolean

  constructor(
    apiKey: string,
    baseURL?: string,
    model?: string,
    thinking?: boolean,
    reasoningEffort?: string,
    enableCache?: boolean,
    strictTools?: boolean,
  ) {
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model || 'gpt-4o'
    this.baseURL = baseURL
    this.thinking = thinking
    this.reasoningEffort = reasoningEffort
    this.enableCache = enableCache ?? false
    // Auto-enable strict mode when using DeepSeek beta endpoint
    this.strictTools = strictTools ?? (baseURL ? /beta/i.test(baseURL) : false)
  }

  async *chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<LLMChunk> {
    const openAIFormattedTools: ChatCompletionTool[] = tools.map(t => {
      const properties: Record<string, unknown> = {}
      for (const [key, param] of Object.entries(t.parameters)) {
        const { required: _, ...rest } = param
        properties[key] = rest
      }

      const required = Object.entries(t.parameters)
        .filter(([, v]) => v.required)
        .map(([k]) => k)

      // In strict mode, all properties must be required
      const strictRequired = this.strictTools ? Object.keys(t.parameters) : required

      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          ...(this.strictTools ? { strict: true } : {}),
          parameters: {
            type: 'object',
            properties,
            required: strictRequired,
            ...(this.strictTools ? { additionalProperties: false } : {}),
          },
        },
      }
    })

    const openAIMessages: ChatCompletionMessageParam[] = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.tool_call_id || '',
          content: m.content || '',
        }
      }
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.content,
          tool_calls: m.tool_calls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input),
            },
          })),
          ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        } as ChatCompletionMessageParam
      }
      if (m.role === 'assistant') {
        return {
          role: 'assistant',
          content: m.content || '',
          ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        } as ChatCompletionMessageParam
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content || '',
      }
    })

    // Detect if we're talking to the official OpenAI API
    const isOfficialOpenAI = this.baseURL ? /api\.openai\.com/i.test(this.baseURL) : true

    // Build reasoning params compatible with the target API
    const reasoningParams: Record<string, unknown> = {}
    if (this.thinking) {
      if (isOfficialOpenAI) {
        reasoningParams.thinking = { type: 'enabled' }
        reasoningParams.reasoning_effort = this.reasoningEffort || 'high'
      } else {
        // Non-OpenAI backends (Ollama, LM Studio, etc.) typically only
        // support 'on'/'off' for reasoning_effort
        reasoningParams.reasoning_effort = 'on'
      }
    }

    const stream: Stream<ChatCompletionChunk> = await (
      this.client.chat.completions.create as (
        params: ExtendedCreateParams,
        options?: RequestOptions,
      ) => Promise<Stream<ChatCompletionChunk>>
    )(
      {
        model: this.model,
        messages: openAIMessages,
        tools: openAIFormattedTools.length > 0 ? openAIFormattedTools : undefined,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningParams,
        ...(this.enableCache ? { enable_cache: true } : {}),
      },
      signal ? { signal } : undefined,
    )

    let currentToolCall: {
      id: string
      name: string
      arguments: string
    } | null = null
    let fullText = ''
    let reasoningContent: string | undefined
    let lastUsage:
      | {
          prompt_tokens?: number
          completion_tokens?: number
          prompt_cache_hit_tokens?: number
          prompt_cache_miss_tokens?: number
        }
      | undefined

    // Track a pending "complete" yield — OpenAI sends finish_reason in a content
    // chunk but sends usage in a *separate final chunk* with no choices/delta.
    // We defer the complete yield until we see the usage chunk (or the stream ends).
    let pendingComplete: {
      finish_reason: string
      reasoning_content?: string
    } | null = null

    for await (const chunk of stream) {
      // Capture usage info if present (may come in a chunk without choices)
      // OpenAI uses prompt_tokens/completion_tokens; map to our input_tokens/output_tokens
      // DeepSeek also returns prompt_cache_hit_tokens & prompt_cache_miss_tokens
      const rawChunk = chunk as {
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          prompt_cache_hit_tokens?: number
          prompt_cache_miss_tokens?: number
        }
      }
      if (rawChunk.usage) {
        lastUsage = rawChunk.usage
        // If we have a pending complete, yield it now with usage
        if (pendingComplete) {
          yield {
            type: 'complete',
            finish_reason: pendingComplete.finish_reason,
            reasoning_content: pendingComplete.reasoning_content,
            usage: {
              input_tokens: rawChunk.usage.prompt_tokens ?? 0,
              output_tokens: rawChunk.usage.completion_tokens ?? 0,
              prompt_cache_hit_tokens: rawChunk.usage.prompt_cache_hit_tokens,
              prompt_cache_miss_tokens: rawChunk.usage.prompt_cache_miss_tokens,
            },
          }
          pendingComplete = null
          reasoningContent = undefined
        }
      }

      const delta = chunk.choices?.[0]?.delta
      if (!delta) {
        continue
      }

      const rawDelta = delta as { reasoning_content?: string }
      if (rawDelta.reasoning_content) {
        reasoningContent = (reasoningContent || '') + rawDelta.reasoning_content
        // Yield reasoning content as it streams, so the session can display it in real-time
        yield { type: 'text', text: '', reasoning_content: rawDelta.reasoning_content }
      }

      if (delta.content) {
        fullText += delta.content
        yield { type: 'text', text: delta.content, reasoning_content: reasoningContent }
        reasoningContent = undefined
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            if (currentToolCall) {
              let input: Record<string, unknown>
              const rawArgs = currentToolCall.arguments || ''
              try {
                input = tryParseJSON(rawArgs || '{}') || {}
              } catch {
                console.error(
                  '[openai] Failed to parse tool_call arguments (flush on new tool):',
                  rawArgs,
                )
                input = {}
              }
              yield {
                type: 'tool_use',
                tool_call: {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  input,
                },
                reasoning_content: reasoningContent,
              }
              reasoningContent = undefined
            }
            currentToolCall = {
              id: tc.id,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            }
          } else if (currentToolCall && tc.function?.arguments) {
            currentToolCall.arguments += tc.function.arguments
          }
        }
      }

      if (chunk.choices?.[0]?.finish_reason) {
        if (currentToolCall) {
          const finalArgs = currentToolCall.arguments || ''
          try {
            const parsed = tryParseJSON(finalArgs || '{}')
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolCall.id,
                name: currentToolCall.name,
                input: parsed || {},
              },
              reasoning_content: reasoningContent,
            }
          } catch {
            console.error(
              '[openai] Failed to parse tool_call arguments (finish_reason):',
              finalArgs,
            )
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolCall.id,
                name: currentToolCall.name,
                input: {},
              },
              reasoning_content: reasoningContent,
            }
          }
          reasoningContent = undefined
          currentToolCall = null
        }

        if (lastUsage) {
          // Usage already arrived (e.g. with some providers/configs that bundle it)
          yield {
            type: 'complete',
            finish_reason: chunk.choices[0].finish_reason,
            reasoning_content: reasoningContent,
            usage: {
              input_tokens: lastUsage.prompt_tokens ?? 0,
              output_tokens: lastUsage.completion_tokens ?? 0,
              prompt_cache_hit_tokens: lastUsage.prompt_cache_hit_tokens,
              prompt_cache_miss_tokens: lastUsage.prompt_cache_miss_tokens,
            },
          }
          reasoningContent = undefined
        } else {
          // Usage will come in a later chunk — defer the complete yield
          pendingComplete = {
            finish_reason: chunk.choices[0].finish_reason,
            reasoning_content: reasoningContent,
          }
          reasoningContent = undefined
        }
      }
    }

    // Flush any pending complete (stream ended without a usage chunk)
    if (pendingComplete) {
      const usage = lastUsage
        ? {
            input_tokens: lastUsage.prompt_tokens ?? 0,
            output_tokens: lastUsage.completion_tokens ?? 0,
            prompt_cache_hit_tokens: lastUsage.prompt_cache_hit_tokens,
            prompt_cache_miss_tokens: lastUsage.prompt_cache_miss_tokens,
          }
        : undefined
      yield {
        type: 'complete',
        finish_reason: pendingComplete.finish_reason,
        reasoning_content: pendingComplete.reasoning_content,
        usage,
      }
      pendingComplete = null
    }

    if (currentToolCall) {
      const usage = lastUsage
        ? {
            input_tokens: lastUsage.prompt_tokens ?? 0,
            output_tokens: lastUsage.completion_tokens ?? 0,
            prompt_cache_hit_tokens: lastUsage.prompt_cache_hit_tokens,
            prompt_cache_miss_tokens: lastUsage.prompt_cache_miss_tokens,
          }
        : undefined
      let input: Record<string, unknown>
      const rawFinalArgs = currentToolCall.arguments || ''
      try {
        input = tryParseJSON(rawFinalArgs || '{}') || {}
      } catch {
        console.error('[openai] Failed to parse tool_call arguments (final flush):', rawFinalArgs)
        input = {}
      }
      yield {
        type: 'tool_use',
        tool_call: {
          id: currentToolCall.id,
          name: currentToolCall.name,
          input,
        },
        reasoning_content: reasoningContent,
        usage,
      }
    }
  }
}
