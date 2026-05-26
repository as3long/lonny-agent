import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { PatchApplier } from '../diff/apply.js'

export function createEditTool(applier: PatchApplier, cwd: string): Tool {
  return {
    definition: {
      name: 'edit',
      description: `Replace an exact block of text in a file. This is the PREFERRED tool for making file changes — simpler and more reliable than batch_edit because it does NOT rely on line numbers or hunk headers.

How to use:
1. Read the file with \`read\` (output shows "<lineNumber>: <content>")
2. Copy the EXACT text you want to replace — include 2-3 lines of surrounding context BEFORE and AFTER for uniqueness
3. Call edit with file_path, old_string (the text to find), and new_string (the replacement)

RULES:
- old_string must match the file EXACTLY, including all whitespace and indentation
- old_string must be UNIQUE in the file — include enough surrounding context to make it unique
- Do NOT include the "<lineNumber>: " prefix from read output in old_string or new_string — only the actual file content
- old_string can span multiple lines

Example:
  read src/config.ts → sees "  autoApprove: boolean" at line 11
  edit tool call:
    file_path: "src/config.ts"
    old_string: "  autoApprove: boolean\n  thinking?: boolean"
    new_string: "  autoApprove: boolean\n  temperature?: number\n  thinking?: boolean"

For edits that touch MULTIPLE files or require creating/deleting files, use \`batch_edit\` instead.`,
      parameters: {
        file_path: {
          type: 'string',
          description: 'Path to the file to modify (relative to cwd, or absolute)',
          required: true,
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace. Must match the file EXACTLY, including all whitespace and indentation. Include 2-3 lines of surrounding context for uniqueness.',
          required: true,
        },
        new_string: {
          type: 'string',
          description: 'The replacement text',
          required: true,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      const filePath = typeof input.file_path === 'string' ? input.file_path : ''
      const oldString = typeof input.old_string === 'string' ? input.old_string : ''
      const newString = typeof input.new_string === 'string' ? input.new_string : ''

      if (!filePath) return { success: false, output: '', error: 'file_path is required' }
      if (!oldString) return { success: false, output: '', error: 'old_string is required' }

      const resolved = path.resolve(cwd, filePath)

      // File existence
      let stat: fs.Stats
      try {
        stat = fs.statSync(resolved)
      } catch {
        return { success: false, output: '', error: `File not found: ${filePath}` }
      }
      if (stat.isDirectory()) {
        return { success: false, output: '', error: `Path is a directory, not a file: ${filePath}` }
      }

      // Must have read before editing
      applier.markRead(resolved)

      const content = fs.readFileSync(resolved, 'utf-8')

      const index = content.indexOf(oldString)
      if (index === -1) {
        return {
          success: false,
          output: '',
          error: `old_string not found in ${filePath}. Make sure it matches EXACTLY, including whitespace and line breaks. Re-run \`read\` on this file to see the exact content.`,
        }
      }

      const lastIndex = content.lastIndexOf(oldString)
      if (index !== lastIndex) {
        return {
          success: false,
          output: '',
          error: `old_string appears MULTIPLE times in ${filePath}. Include more surrounding context (2-3 lines before and after) to make it unique.`,
        }
      }

      const newContent = content.slice(0, index) + newString + content.slice(index + oldString.length)

      if (newContent === content) {
        return { success: false, output: '', error: 'new_string is identical to old_string. No changes made.' }
      }

      try {
        fs.writeFileSync(resolved, newContent, 'utf-8')
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `Failed to write file: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      // Update read-tracking so subsequent edits know the file changed
      applier.markRead(resolved)

      const removedLines = oldString.split('\n').length
      const addedLines = newString.split('\n').length
      return {
        success: true,
        output: `Edited ${path.relative(cwd, resolved).replace(/\\/g, '/')} (${removedLines}→${addedLines} lines)`,
      }
    },
  }
}
