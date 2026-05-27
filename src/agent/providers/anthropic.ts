import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages.js'
import type { ToolDefinition } from '../../tools/types.js'
import type { LLMChunk, LLMMessage, LLMProvider } from '../llm.js'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.client = new Anthropic({ apiKey, baseURL })
    this.model = model || 'claude-sonnet-4-20250514'
  }

  async *chat(messages: LLMMessage[], tools: ToolDefinition[]): AsyncGenerator<LLMChunk> {
    const anthropicTools: Anthropic.Tool[] = tools.map(t => {
      const properties: Record<string, unknown> = {}
      for (const [key, param] of Object.entries(t.parameters)) {
        const { required: _, ...rest } = param
        properties[key] = rest
      }
      return {
        name: t.name,
        description: t.description,
        input_schema: {
          type: 'object' as const,
          properties,
          required: Object.entries(t.parameters)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
      }
    })

    const systemMsg = messages.find(m => m.role === 'system')
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    const anthropicMessages: MessageParam[] = nonSystemMessages.map(m => {
      if (m.role === 'user') {
        return { role: 'user' as const, content: m.content || '' }
      }
      if (m.role === 'assistant') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: 'assistant' as const,
            content: [
              ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.tool_calls.map(tc => ({
                type: 'tool_use' as const,
                id: tc.id,
                name: tc.name,
                input: tc.input,
              })),
            ],
          }
        }
        return { role: 'assistant' as const, content: m.content || '' }
      }
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: m.tool_call_id || '',
              content: m.content || '',
            },
          ],
        }
      }
      return { role: 'user' as const, content: '' }
    })

    const stream = this.client.messages.stream({
      model: this.model,
      system: systemMsg?.content || '',
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
      max_tokens: 8192,
    })

    let currentToolUse: {
      id: string
      name: string
      input: string
    } | null = null

    let inputTokens = 0
    let outputTokens = 0

    for await (const event of stream) {
      if (event.type === 'message_start') {
        if (event.message.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
          currentToolUse.input += event.delta.partial_json
        }
      } else if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          currentToolUse = {
            id: event.content_block.id,
            name: event.content_block.name,
            input: '',
          }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolUse) {
          yield {
            type: 'tool_use',
            tool_call: {
              id: currentToolUse.id,
              name: currentToolUse.name,
              input: JSON.parse(currentToolUse.input || '{}'),
            },
          }
          currentToolUse = null
        }
      } else if (event.type === 'message_stop') {
        yield {
          type: 'complete',
          finish_reason: 'end_turn',
          usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          outputTokens = event.usage.output_tokens ?? 0
        }
        if (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'stop_sequence') {
          if (currentToolUse) {
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolUse.id,
                name: currentToolUse.name,
                input: JSON.parse(currentToolUse.input || '{}'),
              },
            }
            currentToolUse = null
          }
          yield {
            type: 'complete',
            finish_reason: event.delta.stop_reason,
            usage: { input_tokens: inputTokens, output_tokens: outputTokens },
          }
        }
      }
    }
  }
}
