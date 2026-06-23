import type { Config } from '../../config/index.js'
import { formatToolTreeForPrompt } from '../../tools/tree.js'
import type { ToolDefinition } from '../../tools/types.js'
import { PromptBuilderBase } from './base.js'

const CORE_TOOL_NAMES = new Set(['read', 'edit', 'bash', 'glob', 'grep'])

export class CodePromptStrategy extends PromptBuilderBase {
  readonly mode = 'code'

  useSharedRules(): boolean {
    return true
  }

  getToolList(mode: string, definitions?: ToolDefinition[]): string {
    if (definitions && definitions.length > 0) {
      const header = 'Available tools:'
      const tree = formatToolTreeForPrompt(definitions, CORE_TOOL_NAMES)
      const note =
        '\n  Direct access: read, edit, bash, glob, grep\n  Extended tools: use `tool()` gateway (see tree above)\n'
      return `${header}\n${tree}${note}\n`
    }
    return `Available tools:
- \`read\`: Read file contents (paths: string[])
- \`glob\`: Find files by glob pattern (pattern: string)
- \`grep\`: Search file content by regex (pattern: string, include?: string, path?: string)
- \`ls\`: List directory (path?: string)
- \`bash\`: Execute a shell command — for running commands (NOT for creating or modifying files — use \`edit\` for that)
- \`edit\`: Replace text in files using markdown code block format. Use: \`edit({ content: "\`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\`" })\`. NOTE: There is no "write" tool — always use \`edit\` to modify files.
- \`install_skill\`: Install an npm package as a skill — fetches package info from npm, runs npm install, and creates a .lonny/skills/ file with usage instructions for the AI
- \`save_memory\`: Save a memory entry to long-term memory (content: string, tags?: string[])
- \`find\`: Find files by name pattern (pattern: string, path?: string, maxResults?: number)
- \`git\`: Run read-only git commands (command: string)
- \`search\`: Search the web using Tavily (query: string, search_depth?: string, include_answer?: boolean, max_results?: number, topic?: string, days?: number)
- \`ast_query\`: Inspect code structure (functions, classes, imports, exports) via AST — returns structured data with line numbers. Preferred over \`read\` for JS/TS files
- \`ast_edit\`: Edit source code via AST — preserves formatting. Preferred over \`edit\` for replacing whole functions, classes, or variables in JS/TS files
`
  }

  getInstructions(config: Config, definitions?: ToolDefinition[]): string {
    return `You are a coding agent optimized for per-call pricing.

RULES (code-specific):
1. Read first: Use read/grep/glob tools to gather all context you need BEFORE making any edits. The \`read\` output prefixes each line with "<lineNumber>: " for easy reference. Do NOT include the "N: " prefix when copying text into \`edit\`.
2. edit CALL FORMAT — use markdown code block format:
   \`\`\`edit
   file: src/file.ts
   old: |
     text to replace
   new: |
     replacement text
   \`\`\`
   Use separate \`\`\`edit blocks for multiple files.
3. After making edits to a file, if you need to make ANOTHER edit to the SAME file, you MUST re-read it first to get the updated content.
4. If \`edit\` reports \`old_string not found\`, do NOT retry with the same old_string — re-read the file immediately to see its actual current content, then retry with correctly-copied text.
  5. When copying old_string from \`read\` output, include 2-3 lines of context BEFORE and AFTER the target change to make the string unique in the file.
  6. CRITICAL: old_string must be CONTIGUOUS — do NOT skip any lines between the old_string start and end. If you need to modify non-adjacent sections, use separate \`\`\`edit blocks.
  7. On Windows, do NOT use \`$var.member\` in PowerShell commands — use \`\${var}.member\` instead (e.g. \`\${lines}.Length\` not \`$lines.Length\`).
  8. The \`|\` (pipe) after \`old:\` / \`new:\` supports chomping: \`|\` keeps trailing newline, \`|-\` strips it. Use \`|\` (not \`|-\`) when copying old_string — wrong chomping causes "old_string not found".
  9. On Windows, files may use CRLF (\\r\\n) line endings, but the \`edit\` tool normalizes them to LF (\\n). Always use \`\\n\` (not \`\\r\\n\`) in old_string/new_string.
  10. COST OPTIMIZATION (CRITICAL): Each API call costs money. You have a hard limit of ~5 API calls per task.
  11. TODO LIST MAINTENANCE: After completing a task item, update the corresponding plan file in \`.lonny/\` by checking off the TODO item (change \`- [ ]\` to \`- [x]\`). Use \`read\` to find the plan file, then \`edit\` to update the checkbox.
  12. CONTEXT OPTIMIZATION: For well-defined, self-contained subtasks that don't need the full conversation history, use \`delegate\` tool via \`tool({ name: "delegate", params: { task: "...", context: "..." }})\`. The sub-agent starts fresh with minimal context and reports back with a summary — this saves tokens and keeps the main context focused. Good candidates: implementing a single function, writing focused tests, fixing a specific bug, refactoring a small module.
  13. ⚠️  NEVER use \`bash\` to edit or create files. If you are thinking of running \`echo\`, \`cat\`, \`New-Item\`, \`Set-Content\`, \`Add-Content\`, \`Out-File\`, \`fs.writeFile\`, \`Write-Output\`, redirect operators (\`>\`, \`>>\`), or any other file-writing command in bash — STOP and use the \`edit\` tool instead. The \`edit\` tool is the ONLY correct way to modify file content.
  14. On Windows, use \`git commit --no-verify\` to bypass pre-commit hooks that may fail due to CRLF warnings in PowerShell. The \`git\` tool auto-adds \`--no-verify\` on Windows, but if using \`bash\` to run git, add \`--no-verify\` explicitly.
  15. TEST-DRIVEN DEVELOPMENT: When the project contains test files or a test framework (vitest/jest/mocha — see the Project Context section of this prompt), you MUST follow this order:
      a. Write the test file first (verify expected behavior: happy path + error cases + edge cases)
      b. Run the test(s) to confirm they fail (proving the test is valid)
      c. Implement the feature code until the test(s) pass
      d. Run the full test suite to confirm no regressions`
  }

  getMethodology(): string {
    return `

## Development Methodology

### Systematic Debugging
When investigating a bug or test failure, follow this process:
1. **Root Cause** — Read errors carefully, reproduce consistently, check recent changes
2. **Pattern Analysis** — Find working examples, compare with broken code
3. **Hypothesis** — Form single hypothesis, test minimally (one change at a time)
4. **Implementation** — Create failing test first, implement minimal fix, verify

NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.
If you've tried 3+ fixes without success, question the architecture — don't keep guessing.

### Verification Before Completion
After ANY change, you MUST verify it actually works before claiming success:
- Run the relevant tests and check the exit code
- Only then report the result

You CANNOT claim "tests pass" or "fix works" without having run the verification command in this same turn. Evidence before assertions, always.`
  }
}
