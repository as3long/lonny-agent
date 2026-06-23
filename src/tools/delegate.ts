import type { LLMMessage } from '../agent/llm.js'
import { AnthropicProvider } from '../agent/providers/anthropic.js'
import { GoogleProvider } from '../agent/providers/google.js'
import { OllamaProvider } from '../agent/providers/ollama.js'
import { OpenAIProvider } from '../agent/providers/openai.js'
import { compressToolResult } from '../agent/session-utils.js'
import { buildSubAgentPrompt, buildSubAgentToolDefinitions } from '../agent/sub-agent.js'
import type { Config } from '../config/index.js'
import type { ToolRegistry } from '../tools/registry.js'
import { fmtErr } from './errors.js'
import type { Tool, ToolCall, ToolResult } from './types.js'

/**
 * Maximum number of LLM calls a sub-agent can make before being force-summarized.
 * Prevents runaway sub-agents from consuming too many resources.
 */
const DEFAULT_MAX_ITERATIONS = 5

/**
 * Blocked tool names that sub-agents cannot call.
 * These are reserved for the main agent.
 */
const BLOCKED_SUB_AGENT_TOOLS = new Set(['delegate', 'task_complete'])

/**
 * Create a provider instance from config.
 */
function createProvider(config: Config) {
  if (config.provider === 'openai') {
    return new OpenAIProvider(
      config.apiKey,
      config.baseUrl,
      config.model,
      config.thinking,
      config.reasoningEffort,
      config.enableCache,
      config.strictTools,
    )
  }
  if (config.provider === 'google') {
    return new GoogleProvider(config.apiKey, config.baseUrl, config.model)
  }
  if (config.provider === 'ollama') {
    return new OllamaProvider(config.apiKey, config.baseUrl, config.model)
  }
  return new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
}

/**
 * Check if a tool call should be blocked (sub-agent trying to use reserved tools).
 */
function isBlockedTool(toolName: string): boolean {
  return BLOCKED_SUB_AGENT_TOOLS.has(toolName)
}

/**
 * Format the sub-agent's internal messages into a summary string
 * for inclusion in the delegate tool result.
 */
function formatSubAgentResult(
  finalResponse: string,
  iterationCount: number,
  subMessages: LLMMessage[],
): string {
  const subToolCalls = subMessages.filter(m => m.role === 'assistant' && m.tool_calls?.length)
  const toolCallCount = subToolCalls.reduce((sum, m) => sum + (m.tool_calls?.length || 0), 0)
  const subTokens = subMessages.reduce((sum, m) => sum + Math.ceil((m.content || '').length / 4), 0)
  const summaryTokens = Math.ceil(finalResponse.length / 4)
  const savings = Math.max(0, subTokens - summaryTokens)

  let result = `[Sub-Agent Result]\n`
  result += `${finalResponse}\n`
  result += `[Sub-Agent Stats]\n`
  result += `Iterations: ${iterationCount}\n`
  result += `Tool calls: ${toolCallCount}\n`
  result += `Sub-context tokens: ~${subTokens}\n`
  result += `Summary tokens: ~${summaryTokens}\n`
  result += `Tokens saved: ~${savings}\n`

  return result
}

/**
 * Create the `delegate` tool.
 *
 * The delegate tool allows the main agent to spawn a sub-agent with
 * a minimized context. The sub-agent runs its own mini-conversation
 * (LLM ↔ tools) independently and returns a concise summary.
 *
 * @param config - The application config (for creating provider + env info)
 * @param registry - The tool registry (for executing sub-agent tool calls)
 */
export function createDelegateTool(config: Config, registry: ToolRegistry): Tool {
  return {
    definition: {
      name: 'delegate',
      description: `Delegate a well-defined subtask to a sub-agent with minimal context.

  Use this when you have a clear, self-contained task that doesn't need the full conversation history.
  The sub-agent starts fresh with only the task description and optional code context,
  then reports back with a summary. This saves tokens and keeps the main context focused.

  Examples:
    delegate({ task: "Implement sortByDate function in src/utils.ts", context: "Current file content:\\n..." })
    delegate({ task: "Write tests for the parseConfig function", context: read src/parser.ts })
    delegate({ task: "Fix the type error in src/api/handler.ts" })

  Best for: implementing single functions, writing focused tests, fixing specific bugs, refactoring small modules.`,
      parameters: {
        task: {
          type: 'string',
          description: 'The task description for the sub-agent to complete',
          required: true,
        },
        context: {
          type: 'string',
          description: 'Optional relevant code context (file contents, snippets, etc.)',
          required: false,
        },
        maxIterations: {
          type: 'number',
          description: `Maximum LLM calls for the sub-agent (default: ${DEFAULT_MAX_ITERATIONS})`,
          required: false,
        },
      },
    },

    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const task = input.task as string | undefined
      if (!task || typeof task !== 'string') {
        return {
          success: false,
          output: '',
          error:
            'delegate() requires a "task" field (string) describing what the sub-agent should do',
        }
      }

      const context = input.context as string | undefined
      const maxIterations =
        typeof input.maxIterations === 'number'
          ? Math.min(input.maxIterations, 15)
          : DEFAULT_MAX_ITERATIONS

      // ── Build sub-agent system prompt ───────────────────────────────────
      const systemPrompt = buildSubAgentPrompt(config, task, context)

      // ── Create provider ─────────────────────────────────────────────────
      const provider = createProvider(config)

      // ── Get filtered tool definitions for sub-agent ─────────────────────
      const allDefinitions = registry.getDefinitions()
      const subDefinitions = buildSubAgentToolDefinitions(allDefinitions)

      // ── Run sub-agent mini-conversation ─────────────────────────────────
      const subMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task },
      ]

      let finalResponse = ''
      let iterationCount = 0

      for (let iter = 0; iter < maxIterations; iter++) {
        iterationCount++

        // ── Call LLM ────────────────────────────────────────────────────
        let fullResponse = ''
        const toolCalls: ToolCall[] = []

        try {
          const stream = provider.chat(subMessages, subDefinitions)

          for await (const chunk of stream) {
            if (chunk.type === 'text' && chunk.text) {
              fullResponse += chunk.text
            } else if (chunk.type === 'tool_use' && chunk.tool_call) {
              toolCalls.push(chunk.tool_call)
            } else if (chunk.type === 'complete') {
              // End of stream - process usage if needed
            }
          }
        } catch (e) {
          const errMsg = fmtErr(e)
          return {
            success: false,
            output: '',
            error: `Sub-agent LLM call failed at iteration ${iterationCount}: ${errMsg}`,
          }
        }

        // ── No tool calls → final response ──────────────────────────────
        if (toolCalls.length === 0) {
          finalResponse = fullResponse
          // Push assistant message to subMessages for accurate telemetry
          subMessages.push({ role: 'assistant', content: fullResponse })
          break
        }

        // ── Execute tool calls ──────────────────────────────────────────
        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: fullResponse || null,
          tool_calls: toolCalls,
        }
        subMessages.push(assistantMsg)

        for (const tc of toolCalls) {
          // Block reserved tools
          if (isBlockedTool(tc.name)) {
            const errorMsg = `BLOCKED: The tool "${tc.name}" cannot be called from a sub-agent.`
            subMessages.push({
              role: 'tool',
              content: errorMsg,
              tool_call_id: tc.id,
              name: tc.name,
            })
            continue
          }

          // Execute via main registry
          const result = await registry.dispatch(tc)

          const resultMsg: LLMMessage = {
            role: 'tool',
            content: compressToolResult(tc, result),
            tool_call_id: tc.id,
            name: tc.name,
          }
          subMessages.push(resultMsg)
        }

        // ── Check if last iteration ──────────────────────────────────────
        if (iter === maxIterations - 1) {
          finalResponse =
            fullResponse ||
            `[Sub-agent reached max iterations (${maxIterations}) without producing a final response]`
          break
        }
      }

      // ── Format and return result ───────────────────────────────────────
      const result = formatSubAgentResult(finalResponse, iterationCount, subMessages)

      return {
        success: true,
        output: result,
      }
    },
  }
}
