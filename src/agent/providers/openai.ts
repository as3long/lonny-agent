import OpenAI from 'openai'
import { LLMProvider, LLMMessage, LLMChunk } from '../llm.js'
import { ToolDefinition, ToolCall } from '../../tools/types.js'

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.client = new OpenAI({ apiKey, baseURL })
    this.model = model || 'gpt-4o'
  }

  async *chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
  ): AsyncGenerator<LLMChunk> {
    const openAIFormattedTools = tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: t.parameters as Record<string, unknown>,
          required: Object.entries(t.parameters)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
      },
    }))

    const openAIMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          tool_call_id: m.tool_call_id || '',
          content: m.content || '',
        }
      }
      if (m.role === 'assistant' && m.tool_calls) {
        return {
          role: 'assistant' as const,
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
      }
      return {
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content || '',
      }
    })

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openAIMessages as any,
      tools: openAIFormattedTools.length > 0 ? openAIFormattedTools : undefined,
      stream: true,
      stream_options: { include_usage: false },
    })

    let currentToolCall: {
      id: string
      name: string
      arguments: string
    } | null = null
    let fullText = ''

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      if (delta.content) {
        fullText += delta.content
        yield { type: 'text', text: delta.content }
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
              }
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
            }
          } catch {
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolCall.id,
                name: currentToolCall.name,
                input: {},
              },
            }
          }
          currentToolCall = null
        }
        yield { type: 'complete', finish_reason: chunk.choices[0].finish_reason }
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
      }
    }
  }
}