import type { Config } from '../config/index.js'
import type { ToolDefinition } from '../tools/types.js'

export interface BuildContext {
  envSection: string
  sharedRules: string
  projectSection: string
  memorySection: string
  skillsSection: string
}

export interface PromptStrategy {
  /** Mode identifier */
  readonly mode: string

  /**
   * Mode-specific instructions block.
   * For standalone modes (plan/review/ask/loop), this is the FULL prompt content
   * including persona, rules, and output format.
   * For shared-rules modes (code), this is just the persona + mode-specific rules.
   */
  getInstructions(config: Config, definitions?: ToolDefinition[]): string

  /** Tool list description for this mode */
  getToolList(mode: string, definitions?: ToolDefinition[]): string

  /** Methodology/development-process section */
  getMethodology(): string

  /** Whether this mode uses the shared rules section */
  useSharedRules(): boolean

  /**
   * Build the complete system prompt.
   * This is the Template Method — the skeleton algorithm that
   * assembles instructions, environment, rules, methodology, and sections.
   */
  build(config: Config, context: BuildContext, definitions?: ToolDefinition[]): string
}
