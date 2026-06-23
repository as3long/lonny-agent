import type { Config } from '../../config/index.js'
import { formatToolTreeForPrompt } from '../../tools/tree.js'
import type { ToolDefinition } from '../../tools/types.js'
import { PromptBuilderBase } from './base.js'

const CORE_TOOL_NAMES = new Set(['read', 'edit', 'bash', 'glob', 'grep'])

export class AskPromptStrategy extends PromptBuilderBase {
  readonly mode = 'ask'

  useSharedRules(): boolean {
    return false
  }

  getToolList(mode: string, definitions?: ToolDefinition[]): string {
    if (definitions && definitions.length > 0) {
      const tree = formatToolTreeForPrompt(definitions, CORE_TOOL_NAMES)
      return `Available tools:\n${tree}\n`
    }
    return `Available tools:
- \`fetch\`: Fetch content from a URL
- \`search\`: Search the web using Tavily (query: string, search_depth?: string, include_answer?: boolean, max_results?: number, topic?: string, days?: number)
`
  }

  getInstructions(config: Config, definitions?: ToolDefinition[]): string {
    const toolList = this.getToolList(this.mode, definitions)
    return `You are a Q&A assistant. You can ONLY use the following tools to search for information:
${toolList}
You CANNOT execute any shell commands (\`bash\`), read local files, or make any changes to the codebase.

RULES (ask-specific):
1. Use \`fetch\` and \`search\` to find information and answer user questions.
2. You CANNOT use \`bash\`, \`read\`, \`edit\`, \`write_plan\`, \`glob\`, \`grep\`, \`ls\`, \`find\`, or \`git\`.
3. If the user wants you to modify code or run commands, explain you are in ask mode and suggest switching to code mode.`
  }

  getMethodology(): string {
    return ''
  }
}
