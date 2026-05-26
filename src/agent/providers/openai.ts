import OpenAI from 'openai'
import { LLMProvider, LLMMessage, LLMChunk } from '../llm.js'
import { ToolDefinition, ToolCall } from '../../tools/types.js'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string
  private thinking?: boolean
  private reasoningEffort?: string

  constructor(apiKey: string, baseURL?: string, model?: string, thinking?: boolean, reasoningEffort?: string) {
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model || 'gpt-4o'
    this.thinking = thinking
    this.reasoningEffort = reasoningEffort
  }

  async *chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<LLMChunk> {
    const openAIFormattedTools = tools.map(t => {
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

    const openAIMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.tool_call_id || '',
          content: m.content || '',
        }
      }
      if (m.role === 'assistant' && m.tool_calls) {
        const msg: Record<string, unknown> = {
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
        }
        if (m.reasoning_content) {
          msg.reasoning_content = m.reasoning_content
        }
        return msg as any
      }
      if (m.role === 'assistant') {
        const msg: Record<string, unknown> = {
          role: 'assistant',
          content: m.content || '',
        }
        if (m.reasoning_content) {
          msg.reasoning_content = m.reasoning_content
        }
        return msg as any
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content || '',
      }
    })

    const stream = await (this.client.chat.completions.create as any)({
      model: this.model,
      messages: openAIMessages,
      tools: openAIFormattedTools.length > 0 ? openAIFormattedTools : undefined,
      stream: true,
      stream_options: { include_usage: false },
      ...(this.thinking ? { thinking: { type: 'enabled' }, reasoning_effort: this.reasoningEffort || 'high' } : {}),
    })

    let currentToolCall: {
      id: string
      name: string
      arguments: string
    } | null = null
    let fullText = ''
    let reasoningContent: string | undefined

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if ((delta as any).reasoning_content) {
        reasoningContent = (reasoningContent || '') + (delta as any).reasoning_content
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
        yield { type: 'complete', finish_reason: chunk.choices[0].finish_reason, reasoning_content: reasoningContent }
        reasoningContent = undefined
      }
    }

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
    }
  }
}