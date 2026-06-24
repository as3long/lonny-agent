import type { FileReadTracker } from '../../diff/apply.js'
import type { Tool, ToolResult } from '../types.js'
import { executeEditTool } from './edit-execute.js'

export function createEditTool(applier: FileReadTracker, cwd: string): Tool {
  return {
    definition: {
      name: 'edit',
      category: 'Edit',
      group: 'File',
      description: `Replace exact text in files using markdown code block format.
IMPORTANT: There is no "write" tool — always use this tool ("edit") to modify files.

HOW TO USE:
1. Read the file first with \`read\`
2. Copy the EXACT text to replace — include 2-3 lines of context before/after
3. Use markdown code block format below

FORMAT:
\`\`\`edit
file: <file_path>
old: |
  <exact text to find>
new: |
  <replacement text>
\`\`\`

Use separate \`\`\`edit blocks for multiple files.

CRITICAL RULES:
- old and new are separated by "old:" and "new:" labels
- Use | after label for multi-line content
- old_string must match EXACTLY (whitespace, indentation, line breaks)
- old_string must be CONTIGUOUS text from the file — you CANNOT skip lines between old_string and new_string boundaries. If you need to edit non-adjacent sections, use separate \`\`\`edit blocks.`,
      parameters: {
        content: { type: 'string', description: 'Markdown code block with edit instructions. See description for format.', required: true },
      },
    },
    async execute(input): Promise<ToolResult> {
      return executeEditTool(applier, cwd, input)
    },
  }
}
