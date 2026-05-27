import { ToolCall, type ToolDefinition } from '../../tools/types.js'
import type { LLMChunk, LLMMessage, LLMProvider } from '../llm.js'

interface GoogleContent {
  role: 'user' | 'model'
  parts: {
    text?: string
    functionCall?: { name: string; args: Record<string, unknown> }
    functionResponse?: { name: string; response: Record<string, unknown> }
  }[]
}

interface GoogleTool {
  functionDeclarations: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }[]
}

interface GoogleCandidate {
  content: GoogleContent
  finishReason?: string
}

interface GoogleResponse {
  candidates?: GoogleCandidate[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

interface GoogleStreamChunk {
  candidates?: GoogleCandidate[]
  usageMetadata?: GoogleResponse['usageMetadata']
}

export class GoogleProvider implements LLMProvider {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(apiKey: string, baseURL?: string, model?: string) {
    this.apiKey = apiKey
    this.model = model || 'gemini-2.0-flash'
    this.baseUrl = baseURL || 'https://generativelanguage.googleapis.com/v1beta'
  }

  async *chat(messages: LLMMessage[], tools: ToolDefinition[]): AsyncGenerator<LLMChunk> {
    const systemInstruction = messages.find(m => m.role === 'system')?.content || ''
    const nonSystemMessages = messages.filter(m => m.role !== 'system')

    // Build Google-format contents
    const contents: GoogleContent[] = []

    for (const m of nonSystemMessages) {
      if (m.role === 'user') {
        const parts: GoogleContent['parts'] = [{ text: m.content || '' }]
        contents.push({ role: 'user', parts })
      } else if (m.role === 'assistant') {
        const parts: GoogleContent['parts'] = []
        if (m.content) {
          parts.push({ text: m.content })
        }
        if (m.tool_calls) {
          for (const tc of m.tool_calls) {
            parts.push({
              functionCall: {
                name: tc.name,
                args: tc.input as Record<string, unknown>,
              },
            })
          }
        }
        contents.push({ role: 'model', parts })
      } else if (m.role === 'tool') {
        // Tool results are sent as functionResponse in a user message
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: m.name || '',
                response: { content: m.content || '' },
              },
            },
          ],
        })
      }
    }

    // Build tools
    const googleTools: GoogleTool[] | undefined =
      tools.length > 0
        ? [
            {
              functionDeclarations: tools.map(t => {
                const properties: Record<string, unknown> = {}
                for (const [key, param] of Object.entries(t.parameters)) {
                  const { required: _, ...rest } = param
                  properties[key] = rest
                }
                return {
                  name: t.name,
                  description: t.description,
                  parameters: {
                    type: 'object',
                    properties,
                    required: Object.entries(t.parameters)
                      .filter(([, v]) => v.required)
                      .map(([k]) => k),
                  },
                }
              }),
            },
          ]
        : undefined

    // Build request body
    const body: Record<string, unknown> = {
      contents,
      tools: googleTools,
    }
    if (systemInstruction) {
      body.system_instruction = { parts: [{ text: systemInstruction }] }
    }

    // Make streaming API call
    const url = `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Google API error (${response.status}): ${errText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let totalInput = 0
    let totalOutput = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        try {
          const chunk = JSON.parse(jsonStr) as GoogleStreamChunk
          if (chunk.usageMetadata) {
            totalInput = chunk.usageMetadata.promptTokenCount ?? 0
            totalOutput = chunk.usageMetadata.candidatesTokenCount ?? 0
          }

          if (!chunk.candidates?.[0]) continue
          const candidate = chunk.candidates[0]
          const part = candidate.content?.parts?.[0]

          if (part?.text) {
            yield { type: 'text', text: part.text }
          }

          if (part?.functionCall) {
            yield {
              type: 'tool_use',
              tool_call: {
                id: `fc-${part.functionCall.name}-${Date.now()}`,
                name: part.functionCall.name,
                input: part.functionCall.args,
              },
            }
          }

          if (candidate.finishReason) {
            yield {
              type: 'complete',
              finish_reason: candidate.finishReason,
              usage: { input_tokens: totalInput, output_tokens: totalOutput },
            }
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }
}
