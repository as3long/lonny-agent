import { ToolCall, type ToolDefinition } from '../../tools/types.js'
import type { LLMChunk, LLMMessage, LLMProvider } from '../llm.js'

interface OllamaTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: {
    function: {
      name: string
      arguments: string
    }
  }[]
}

interface OllamaResponse {
  model: string
  created_at: string
  message: OllamaMessage
  done: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string
  private model: string

  constructor(_apiKey: string, baseURL?: string, model?: string) {
    this.baseUrl = baseURL || 'http://localhost:11434'
    this.model = model || 'llama3.2'
  }

  async *chat(messages: LLMMessage[], tools: ToolDefinition[]): AsyncGenerator<LLMChunk> {
    // Build Ollama-format messages
    const ollamaMessages: OllamaMessage[] = messages.map(m => {
      if (m.role === 'system') {
        return { role: 'system', content: m.content || '' }
      }
      if (m.role === 'user') {
        return { role: 'user', content: m.content || '' }
      }
      if (m.role === 'assistant') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || '',
            tool_calls: m.tool_calls.map(tc => ({
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.input),
              },
            })),
          }
        }
        return { role: 'assistant', content: m.content || '' }
      }
      if (m.role === 'tool') {
        return { role: 'tool', content: m.content || '' }
      }
      return { role: 'user', content: '' }
    })

    // Build tools
    const ollamaTools: OllamaTool[] | undefined =
      tools.length > 0
        ? tools.map(t => {
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
        : undefined

    const body: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: true,
    }
    if (ollamaTools && ollamaTools.length > 0) {
      body.tools = ollamaTools
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Ollama API error (${response.status}): ${errText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const chunk = JSON.parse(line) as OllamaResponse

          if (chunk.message?.content) {
            yield { type: 'text', text: chunk.message.content }
          }

          if (chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              let input: Record<string, unknown> = {}
              try {
                input = JSON.parse(tc.function.arguments || '{}')
              } catch {
                input = {}
              }
              yield {
                type: 'tool_use',
                tool_call: {
                  id: `ollama-${tc.function.name}-${Date.now()}`,
                  name: tc.function.name,
                  input,
                },
              }
            }
          }

          if (chunk.done) {
            yield {
              type: 'complete',
              finish_reason: chunk.done_reason || 'stop',
              usage: {
                input_tokens: chunk.prompt_eval_count ?? 0,
                output_tokens: chunk.eval_count ?? 0,
              },
            }
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}
