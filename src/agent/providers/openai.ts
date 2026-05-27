import OpenAI from 'openai'
import type { Stream } from 'openai/streaming.js'
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionChunk } from 'openai/resources/chat/completions.js'
import { LLMProvider, LLMMessage, LLMChunk } from '../llm.js'
import { ToolDefinition, ToolCall } from '../../tools/types.js'

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

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string
  private thinking?: boolean
  private reasoningEffort?: string
  private enableCache: boolean

  constructor(apiKey: string, baseURL?: string, model?: string, thinking?: boolean, reasoningEffort?: string, enableCache?: boolean) {
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model || 'gpt-4o'
    this.thinking = thinking
    this.reasoningEffort = reasoningEffort
    this.enableCache = enableCache ?? false
  }

  async *chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<LLMChunk> {
    const openAIFormattedTools: ChatCompletionTool[] = tools.map(t => {
      const properties: Record<string, unknown> = {}
      for (const [key, param] of Object.entries(t.parameters)) {
        const { required: _, ...rest } = param
        properties[key] = rest
      }
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties,
            required: Object.entries(t.parameters)
              .filter(([, v]) => v.required)
              .map(([k]) => k),
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
      if (m.role === 'assistant' && m.tool_calls) {
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

    const stream: Stream<ChatCompletionChunk> = await (this.client.chat.completions.create as (params: ExtendedCreateParams) => Promise<Stream<ChatCompletionChunk>>)({
      model: this.model,
      messages: openAIMessages,
      tools: openAIFormattedTools.length > 0 ? openAIFormattedTools : undefined,
      stream: true,
      stream_options: { include_usage: true },
      ...(this.thinking ? { thinking: { type: 'enabled' }, reasoning_effort: this.reasoningEffort || 'high' } : {}),
      ...(this.enableCache ? { enable_cache: true } : {}),
    })

    let currentToolCall: {
      id: string
      name: string
      arguments: string
    } | null = null
    let fullText = ''
    let reasoningContent: string | undefined
    let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined

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
      const rawChunk = chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
      if (rawChunk.usage) {
        lastUsage = rawChunk.usage
        // If we have a pending complete, yield it now with usage
        if (pendingComplete) {
          yield {
            type: 'complete',
            finish_reason: pendingComplete.finish_reason,
            reasoning_content: pendingComplete.reasoning_content,
            usage: { input_tokens: rawChunk.usage.prompt_tokens ?? 0, output_tokens: rawChunk.usage.completion_tokens ?? 0 },
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
              yield {
                type: 'tool_use',
                tool_call: {
                  id: currentToolCall.id,
                  name: currentToolCall.name,
                  input: JSON.parse(currentToolCall.arguments || '{}'),
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
          try {
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolCall.id,
                name: currentToolCall.name,
                input: JSON.parse(currentToolCall.arguments || '{}'),
              },
              reasoning_content: reasoningContent,
            }
          } catch {
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
            usage: { input_tokens: lastUsage.prompt_tokens ?? 0, output_tokens: lastUsage.completion_tokens ?? 0 },
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
        ? { input_tokens: lastUsage.prompt_tokens ?? 0, output_tokens: lastUsage.completion_tokens ?? 0 }
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
        ? { input_tokens: lastUsage.prompt_tokens ?? 0, output_tokens: lastUsage.completion_tokens ?? 0 }
        : undefined
      yield {
        type: 'tool_use',
        tool_call: {
          id: currentToolCall.id,
          name: currentToolCall.name,
          input: JSON.parse(currentToolCall.arguments || '{}'),
        },
        reasoning_content: reasoningContent,
        usage,
      }
    }
  }
}