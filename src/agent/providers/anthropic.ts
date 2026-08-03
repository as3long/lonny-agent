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

  async *chat(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<LLMChunk> {
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

    // Anthropic prompt caching (cache_control, ephemeral 5-min TTL):
    // 1. Cache the SYSTEM prompt — it's identical on every request in a
    //    session (we already keep it byte-stable across turns), so the
    //    provider cache-reads it instead of re-processing it.
    // 2. Add a second breakpoint at the LAST plain user message so the
    //    whole conversation prefix is cache-read on subsequent requests
    //    within the TTL. Tool-result user messages are skipped — their
    //    breakpoint would move every tool-loop iteration, forcing cache
    //    writes instead of reads.
    const systemBlock: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[] =
      systemMsg?.content
        ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
        : []
    for (let i = anthropicMessages.length - 1; i >= 0; i--) {
      const m = anthropicMessages[i]
      if (m.role === 'user' && typeof m.content === 'string') {
        // Cast needed: the installed SDK's TextBlockParam predates cache_control.
        anthropicMessages[i] = {
          role: 'user',
          content: [
            {
              type: 'text',
              text: m.content || '',
              cache_control: { type: 'ephemeral' },
            },
          ],
        } as unknown as MessageParam
        break
      }
    }

    const stream = this.client.messages.stream(
      {
        model: this.model,
        system: systemBlock,
        messages: anthropicMessages,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        max_tokens: 8192,
      },
      signal ? { signal } : undefined,
    )

    let currentToolUse: {
      id: string
      name: string
      input: string
    } | null = null

    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0

    /** Build the usage object; maps Anthropic cache tokens to DeepSeek-style fields. */
    const buildUsage = () => ({
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      prompt_cache_hit_tokens: cacheReadTokens,
      prompt_cache_miss_tokens:
        cacheCreationTokens > 0 ? cacheCreationTokens : Math.max(0, inputTokens - cacheReadTokens),
    })

    for await (const event of stream) {
      if (event.type === 'message_start') {
        if (event.message.usage) {
          // The installed SDK's Usage type predates cache fields — read them
          // through a structural cast so cache stats still surface in the UI.
          const usage = event.message.usage as unknown as {
            input_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          inputTokens = usage.input_tokens ?? 0
          cacheReadTokens = usage.cache_read_input_tokens ?? 0
          cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
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
          let input: Record<string, unknown>
          const rawInput = currentToolUse.input || ''
          try {
            input = JSON.parse(rawInput || '{}')
          } catch {
            console.error(
              '[anthropic] Failed to parse tool_use input (content_block_stop):',
              rawInput,
            )
            input = {}
          }
          yield {
            type: 'tool_use',
            tool_call: {
              id: currentToolUse.id,
              name: currentToolUse.name,
              input,
            },
          }
          currentToolUse = null
        }
      } else if (event.type === 'message_stop') {
        yield {
          type: 'complete',
          finish_reason: 'end_turn',
          usage: buildUsage(),
        }
      } else if (event.type === 'message_delta') {
        if (event.usage) {
          outputTokens = event.usage.output_tokens ?? 0
        }
        if (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'stop_sequence') {
          if (currentToolUse) {
            let input: Record<string, unknown>
            const rawInput = currentToolUse.input || ''
            try {
              input = JSON.parse(rawInput || '{}')
            } catch {
              console.error('[anthropic] Failed to parse tool_use input (message_delta):', rawInput)
              input = {}
            }
            yield {
              type: 'tool_use',
              tool_call: {
                id: currentToolUse.id,
                name: currentToolUse.name,
                input,
              },
            }
            currentToolUse = null
          }
          yield {
            type: 'complete',
            finish_reason: event.delta.stop_reason,
            usage: buildUsage(),
          }
        }
      }
    }
  }
}
