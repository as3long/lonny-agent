import type { Config } from '../../config/index.js'
import type { ToolDefinition } from '../../tools/types.js'
import type { BuildContext, PromptStrategy } from '../prompt-builder-types.js'

/**
 * Abstract base class for prompt-building strategies.
 *
 * Uses Template Method pattern — `build()` defines the skeleton
 * and subclasses implement the abstract hooks.
 */
export abstract class PromptBuilderBase implements PromptStrategy {
  abstract readonly mode: string
  abstract getInstructions(config: Config, definitions?: ToolDefinition[]): string
  abstract getToolList(mode: string, definitions?: ToolDefinition[]): string
  abstract getMethodology(): string
  abstract useSharedRules(): boolean

  /**
   * Template method: builds the complete system prompt.
   * The skeleton is: modeInstructions + envSection + [sharedRules] + methodology + project + skills + memory + plan
   *
   * Section ORDER matters for provider-side prefix caching (DeepSeek KV cache /
   * context caching): the provider caches the longest common prefix of input
   * tokens, and any change in the middle invalidates everything after it.
   * Stable sections come FIRST (instructions, env, rules, methodology, project,
   * skills); volatile sections that change mid-session — auto-memory entries
   * (appended by session-memory.ts) and plan checkboxes — come LAST so a change
   * only re-computes the tail, keeping the long prefix cacheable.
   */
  build(config: Config, context: BuildContext, definitions?: ToolDefinition[]): string {
    const instructions = this.getInstructions(config, definitions)
    const methodology = this.getMethodology()

    let result = `${instructions}\n\n${context.envSection}`

    if (this.useSharedRules()) {
      result += context.sharedRules
    }

    result += methodology
    result += context.projectSection
    result += context.skillsSection
    result += context.memorySection

    // Plan section (from .lonny/*.md with ## Todo List) — always appended LAST
    // for maximum prompt cache stability (changes infrequently)
    if (context.planSection) {
      result += `\n${context.planSection}`
    }

    return result
  }
}
