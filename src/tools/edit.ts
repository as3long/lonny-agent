import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { FileReadTracker } from '../diff/apply.js'

interface SingleEdit {
  file_path: string
  old_string: string
  new_string: string
}

function performEdit(filePath: string, oldString: string, newString: string, applier: FileReadTracker, cwd: string): { ok: true; removed: number; added: number } | { ok: false; error: string } {
  const resolved = path.resolve(cwd, filePath)

  // Create mode: old_string is empty, write new_string to a new file.
  if (oldString === '') {
    if (fs.existsSync(resolved)) {
      return { ok: false, error: `File already exists: ${filePath}. Use a non-empty old_string to edit it.` }
    }
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, newString, 'utf-8')
    } catch (err) {
      return { ok: false, error: `Failed to create ${filePath}: ${err instanceof Error ? err.message : String(err)}` }
    }
    applier.markRead(resolved)
    const added = newString.split('\n').length
    return { ok: true, removed: 0, added }
  }

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

  const rawContent = fs.readFileSync(resolved, 'utf-8')
  // Normalize CRLF → LF so that old_string (which has \n) matches files
  // saved with \r\n on Windows.
  const content = rawContent.replace(/\r\n/g, '\n')

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

export function createEditTool(applier: FileReadTracker, cwd: string): Tool {
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

  Create a new file (pass empty string for old_string — do NOT omit the field):
    file_path: "src/new.ts"
    old_string: ""
    new_string: "const x = 1\\nexport { x }"`,
      parameters: {
        file_path: {
          type: 'string',
          description: 'File path for a single edit (relative to cwd, or absolute). When using batch mode, use the "edits" array instead.',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace (single-edit mode). Must match the file EXACTLY. Pass empty string "" to create a new file. You MUST include this field even for new files.',
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
              old_string: { type: 'string', description: 'Text to replace (pass empty string "" to create a new file). Required.' },
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
        if (!('old_string' in input)) return { success: false, output: '', error: 'old_string is required — even for new files, you MUST include old_string: "" (empty string). Do NOT omit the field.' }
        edits = [{ file_path: fp, old_string: os, new_string: ns }]
      }

      // Group edits by resolved file path
      const fileGroups = new Map<string, { edits: SingleEdit[]; originalContent: string | null }>()
      for (const e of edits) {
        const resolved = path.resolve(cwd, e.file_path)
        if (!fileGroups.has(resolved)) {
          let originalContent: string | null = null
          try { originalContent = fs.readFileSync(resolved, 'utf-8') } catch { /* file doesn't exist yet */ }
          fileGroups.set(resolved, { edits: [], originalContent })
        }
        fileGroups.get(resolved)!.edits.push(e)
      }

      const results: string[] = []
      let anyFailed = false
      let firstError = ''
      const modifiedFiles = new Map<string, string | null>() // resolved path → new content (null = deleted)

      for (const [resolved, group] of fileGroups) {
        const relPath = path.relative(cwd, resolved).replace(/\\/g, '/')
        let content = group.originalContent !== null ? group.originalContent.replace(/\r\n/g, '\n') : null

        // Process in reverse order so positions stay valid
        for (let i = group.edits.length - 1; i >= 0; i--) {
          const e = group.edits[i]

          if (e.old_string === '') {
            // Create mode
            if (content !== null) {
              results.push(`  FAIL ${relPath}: File already exists`)
              if (!anyFailed) { anyFailed = true; firstError = `File already exists: ${relPath}` }
              break
            }
            content = e.new_string
            results.push(`  Created ${relPath} (${e.new_string.split('\n').length} lines)`)
            continue
          }

          // Edit mode
          if (content === null) {
            results.push(`  FAIL ${relPath}: File not found`)
            if (!anyFailed) { anyFailed = true; firstError = `File not found: ${relPath}` }
            break
          }

          const idx = content.indexOf(e.old_string)
          if (idx === -1) {
            results.push(`  FAIL ${relPath}: old_string not found`)
            if (!anyFailed) { anyFailed = true; firstError = `old_string not found in ${relPath}` }
            break
          }
          const lastIdx = content.lastIndexOf(e.old_string)
          if (idx !== lastIdx) {
            results.push(`  FAIL ${relPath}: old_string appears MULTIPLE times`)
            if (!anyFailed) { anyFailed = true; firstError = `old_string appears MULTIPLE times in ${relPath}` }
            break
          }

          content = content.slice(0, idx) + e.new_string + content.slice(idx + e.old_string.length)
        }

        if (anyFailed) break
        modifiedFiles.set(resolved, content)
      }

      // Rollback on failure
      if (anyFailed) {
        for (const [filePath, group] of fileGroups) {
          const originalContent = group.originalContent
          if (originalContent === null) {
            try { fs.unlinkSync(filePath) } catch { /* ok */ }
          } else {
            try {
              fs.mkdirSync(path.dirname(filePath), { recursive: true })
              fs.writeFileSync(filePath, originalContent, 'utf-8')
            } catch { /* ok */ }
          }
          applier.markRead(filePath)
        }
        return {
          success: false,
          output: '',
          error: `Edit batch failed — all changes rolled back.\n${results.join('\n')}\n\nFirst error: ${firstError}`,
        }
      }

      // Write all modified files
      for (const [resolved, content] of modifiedFiles) {
        try {
          if (content === null) {
            fs.unlinkSync(resolved)
          } else {
            fs.mkdirSync(path.dirname(resolved), { recursive: true })
            fs.writeFileSync(resolved, content, 'utf-8')
          }
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Failed to write ${path.relative(cwd, resolved).replace(/\\/g, '/')}: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
        applier.markRead(resolved)
      }

      return {
        success: true,
        output: results.join('\n').replace(/^ {2}/gm, ''),
      }
    },
  }
}
