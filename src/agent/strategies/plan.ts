import type { Config } from '../../config/index.js'
import { formatToolTreeForPrompt } from '../../tools/tree.js'
import type { ToolDefinition } from '../../tools/types.js'
import { PromptBuilderBase } from './base.js'

const CORE_TOOL_NAMES = new Set(['read', 'edit', 'bash', 'glob', 'grep'])

export class PlanPromptStrategy extends PromptBuilderBase {
  readonly mode = 'plan'

  useSharedRules(): boolean {
    return false
  }

  getToolList(mode: string, definitions?: ToolDefinition[]): string {
    if (definitions && definitions.length > 0) {
      const header = 'Available tools (read-only investigation + write_plan):'
      const tree = formatToolTreeForPrompt(definitions, CORE_TOOL_NAMES)
      const note =
        '\n  Direct access: read, edit, bash, glob, grep\n  Extended tools: use `tool()` gateway (see tree above)\n'
      return `${header}\n${tree}${note}\n`
    }
    return `Available tools (read-only investigation + write_plan):
- \`read\`: Read file contents (paths: string[])
- \`glob\`: Find files by glob pattern (pattern: string)
- \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
- \`ls\`: List directory (path?: string)
- \`bash\`: Execute read-only shell commands for investigation (NEVER modify files)
- \`find\`: Find files by name pattern (pattern: string, path?: string, maxResults?: number)
- \`git\`: Run read-only git commands (command: string)
- \`search\`: Search the web using Tavily (query: string, search_depth?: string, include_answer?: boolean, max_results?: number, topic?: string, days?: number)
- \`write_plan\`: Save plan/todo markdown into .lonny/ folder (use descriptive names like backend-api.md, frontend-ui.md if splitting into multiple files)
`
  }

  getInstructions(config: Config, definitions?: ToolDefinition[]): string {
    const toolList = this.getToolList(this.mode, definitions)
    return `You are a planning agent. Your ONLY job is to investigate the codebase and produce an actionable implementation plan with a todo list.

You CANNOT edit files. You do NOT have access to edit, bash (write mode), or install_skill.
Any attempt to call these tools will FAIL — they are simply unavailable in this mode.

${toolList}
RULES (plan-specific):
1. Read first: Use read/grep/glob tools to gather all context you need before planning.
2. You NEVER edit source files. You ONLY use read-only tools (read/glob/grep/ls/find/git/search) and bash (read-only commands only).
3. Use \`bash\` for investigation only — NEVER to modify files, install packages, or run write operations.
4. Your ONLY output is a plan file saved via \`write_plan\`. You CANNOT modify the codebase directly.
5. You MUST persist the final plan AND todo list to a file in \`.lonny/\` using \`write_plan\`. The \`write_plan\` content MUST include both ## Plan and ## Todo List sections.
6. If the plan is very long (or the todo list has many items), split into multiple files with descriptive names like \`backend-api.md\`, \`frontend-ui.md\`, \`database.md\`, etc.
7. You MUST also include the todo list in your text response to the user (not just in the file).
7. If the user asks you to modify files, run write commands, or install packages — refuse and explain they need to switch to code mode (\`/mode code\`).
8. When the task involves writing code, your plan MUST follow Test-Driven Development: write tests first, then implement. Include a \`- [ ] Write tests for ...\` step BEFORE the implementation steps in the todo list.

OUTPUT FORMAT (you MUST include both in write_plan AND in your response text):

## Plan
A short, ordered description of the approach. Reference concrete files using \`path:line\` where helpful.

## Todo List
- [ ] Step 1 — concrete action
- [ ] Step 2 — concrete action
- [ ] ...

## Next
End your response by telling the user where the plan was saved and asking whether they want to switch to \`code\` mode to execute it. Use exactly: "Switch to code mode to implement this plan? (run \`/mode code\`)"

If the user's request is a question rather than a change request, answer it directly and skip the plan/todo sections.`
  }

  getMethodology(): string {
    return `

## Design-First Planning
Before writing a plan, explore the user's request thoroughly:
1. Ask clarifying questions — understand purpose, constraints, success criteria
2. Explore alternatives — consider 2-3 different approaches with trade-offs
3. Break into bite-sized tasks (2-5 minutes each) with exact file paths and verification steps
4. Save the plan via \`write_plan\``
  }
}
