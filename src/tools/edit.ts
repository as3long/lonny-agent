import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { PatchApplier } from '../diff/apply.js'

interface SingleEdit {
  file_path: string
  old_string: string
  new_string: string
}

function performEdit(filePath: string, oldString: string, newString: string, applier: PatchApplier, cwd: string): { ok: true; removed: number; added: number } | { ok: false; error: string } {
  const resolved = path.resolve(cwd, filePath)

  let stat: fs.Stats
  try {
    stat = fs.statSync(resolved)
  } catch {
    return { ok: false, error: `File not found: ${filePath}` }
  }
  if (stat.isDirectory()) {
    return { ok: false, error: `Path is a directory, not a file: ${filePath}` }
  }

  applier.markRead(resolved)

  const content = fs.readFileSync(resolved, 'utf-8')

  const index = content.indexOf(oldString)
  if (index === -1) {
    return { ok: false, error: `old_string not found in ${filePath}. Make sure it matches EXACTLY, including whitespace and line breaks. Re-run \`read\` on this file to see the exact content.` }
  }

  const lastIndex = content.lastIndexOf(oldString)
  if (index !== lastIndex) {
    return { ok: false, error: `old_string appears MULTIPLE times in ${filePath}. Include more surrounding context (2-3 lines before and after) to make it unique.` }
  }

  const newContent = content.slice(0, index) + newString + content.slice(index + oldString.length)
  if (newContent === content) {
    return { ok: false, error: `new_string is identical to old_string in ${filePath}. No changes made.` }
  }

  try {
    fs.writeFileSync(resolved, newContent, 'utf-8')
  } catch (err) {
    return { ok: false, error: `Failed to write ${filePath}: ${err instanceof Error ? err.message : String(err)}` }
  }

  applier.markRead(resolved)
  return { ok: true, removed: oldString.split('\n').length, added: newString.split('\n').length }
}

export function createEditTool(applier: PatchApplier, cwd: string): Tool {
  return {
    definition: {
      name: 'edit',
      description: `Replace exact blocks of text in one or more files. This is the PREFERRED tool for making file changes — simpler and more reliable than batch_edit because it uses exact string matching (no line numbers or hunk headers).

HOW TO USE:
1. Read each file with \`read\` first
2. Copy the EXACT text you want to replace — include 2-3 lines of context BEFORE and AFTER for uniqueness
3. Call edit with one or more edits:
   - Single: \`file_path\`, \`old_string\`, \`new_string\`
   - Batch: \`edits: [{ file_path, old_string, new_string }, ...]\`

RULES:
- old_string must match the file EXACTLY (whitespace, indentation, everything)
- old_string must be UNIQUE in the file — include enough surrounding context
- Do NOT include the "<lineNumber>: " prefix from read output
- old_string can span multiple lines (include surrounding lines for uniqueness)

EXAMPLES:
  Single file:
    file_path: "src/config.ts"
    old_string: "  autoApprove: boolean\\n  thinking?: boolean"
    new_string: "  autoApprove: boolean\\n  temperature?: number\\n  thinking?: boolean"

  Batch (one tool call, multiple files/edits):
    edits: [
      { file_path: "src/config.ts", old_string: "mode: 'code'", new_string: "mode: 'plan'" },
      { file_path: "src/cli/index.ts", old_string: "let mode: string", new_string: "let mode: 'code' | 'plan'" }
    ]

For creating or deleting files, use \`batch_edit\`.`,
      parameters: {
        file_path: {
          type: 'string',
          description: 'File path for a single edit (relative to cwd, or absolute). When using batch mode, use the "edits" array instead.',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace (single-edit mode). Must match the file EXACTLY.',
        },
        new_string: {
          type: 'string',
          description: 'The replacement text (single-edit mode).',
        },
        edits: {
          type: 'array',
          description: 'Array of edits for batch mode. Each entry: { file_path, old_string, new_string }. More efficient than separate tool calls.',
          items: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'Path to the file' },
              old_string: { type: 'string', description: 'Text to replace' },
              new_string: { type: 'string', description: 'Replacement text' },
            },
          },
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      let edits: SingleEdit[]

      if (Array.isArray(input.edits)) {
        edits = input.edits as SingleEdit[]
        if (edits.length === 0) {
          return { success: false, output: '', error: 'edits array is empty' }
        }
      } else {
        const fp = typeof input.file_path === 'string' ? input.file_path : ''
        const os = typeof input.old_string === 'string' ? input.old_string : ''
        const ns = typeof input.new_string === 'string' ? input.new_string : ''
        if (!fp) return { success: false, output: '', error: 'file_path is required (or use edits: [...])' }
        if (!os) return { success: false, output: '', error: 'old_string is required' }
        edits = [{ file_path: fp, old_string: os, new_string: ns }]
      }

      // Take snapshots before making any changes (for rollback)
      const snapshots: Map<string, string | null> = new Map()
      for (const e of edits) {
        const resolved = path.resolve(cwd, e.file_path)
        if (snapshots.has(resolved)) continue
        try {
          const content = fs.readFileSync(resolved, 'utf-8')
          snapshots.set(resolved, content)
        } catch {
          snapshots.set(resolved, null)
        }
      }

      const results: string[] = []
      let anyFailed = false
      let firstError = ''

      for (const e of edits) {
        const r = performEdit(e.file_path, e.old_string, e.new_string, applier, cwd)
        if (r.ok) {
          results.push(`  OK ${e.file_path} (${r.removed}→${r.added} lines)`)
        } else {
          results.push(`  FAIL ${e.file_path}: ${r.error}`)
          if (!anyFailed) {
            anyFailed = true
            firstError = r.error
          }
        }
      }

      // If any edit failed, rollback all snapshots
      if (anyFailed) {
        for (const [filePath, content] of snapshots) {
          const relPath = path.relative(cwd, filePath).replace(/\\/g, '/')
          if (content === null) {
            try { fs.unlinkSync(filePath) } catch { /* ok */ }
          } else {
            try {
              fs.mkdirSync(path.dirname(filePath), { recursive: true })
              fs.writeFileSync(filePath, content, 'utf-8')
            } catch { /* ok */ }
          }
        }
        // Re-read tracked files so subsequent checks don't trip on timestamps
        for (const [filePath] of snapshots) {
          applier.markRead(filePath)
        }
        return {
          success: false,
          output: '',
          error: `Edit batch failed — all changes rolled back.\n${results.join('\n')}\n\nFirst error: ${firstError}`,
        }
      }

      return {
        success: true,
        output: results.length === 1 ? results[0].slice(3) : `Applied ${results.length} edits:\n${results.join('\n')}`,
      }
    },
  }
}
