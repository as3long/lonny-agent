import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileReadTracker } from '../diff/apply.js'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

interface SingleEdit {
  file_path: string
  old_string: string
  new_string: string
}

export function createEditTool(applier: FileReadTracker, cwd: string): Tool {
  return {
    definition: {
      name: 'edit',
      description: `Replace exact blocks of text in one or more files. Always uses batch mode via the \`edits\` array.

HOW TO USE:
1. Read each file with \`read\` first
2. Copy the EXACT text you want to replace — include 2-3 lines of context BEFORE and AFTER for uniqueness
3. Call edit with \`edits: [{ file_path, old_string, new_string }, ...]\`

RULES:
- old_string must match the file EXACTLY (whitespace, indentation, everything)
- old_string must be UNIQUE in the file — include enough surrounding context
- Do NOT include the "<lineNumber>: " prefix from read output
- old_string can span multiple lines (include surrounding lines for uniqueness)

EXAMPLES:
  edits: [
    { file_path: "src/config.ts", old_string: "mode: 'code'", new_string: "mode: 'plan'" },
    { file_path: "src/cli/index.ts", old_string: "let mode: string", new_string: "let mode: 'code' | 'plan'" }
  ]

  Create a new file (pass empty string for old_string):
  edits: [
    { file_path: "src/new.ts", old_string: "", new_string: "const x = 1\\nexport { x }" }
  ]`,
      parameters: {
        edits: {
          type: 'array',
          description:
            'Array of edits. Each entry: { file_path, old_string, new_string }. Use this for ALL edits — single or batch.',
          required: true,
          items: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'Path to the file', required: true },
              old_string: {
                type: 'string',
                description:
                  'Text to replace (pass empty string "" to create a new file). Required.',
                required: true,
              },
              new_string: { type: 'string', description: 'Replacement text', required: true },
            },
            required: true,
          },
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      // ── Auto-correction: detect common misuse patterns ────────────────
      // ── Debug: log raw input for diagnosing failures ─────────────
      const rawInput = JSON.parse(JSON.stringify(input))

      // Pattern 0: input is an array (edits passed directly instead of wrapped)
      if (Array.isArray(input)) {
        input = { edits: input }
      }

      // Pattern 1: input has file_path, old_string, new_string at top level (missing edits array)
      if (!Array.isArray(input.edits)) {
        const keys = Object.keys(input)

        // Check if the keys look like a single edit object (file_path + old_string + new_string)
        const hasFilePath = typeof input.file_path === 'string'
        const hasOldString = typeof input.old_string === 'string'
        const hasNewString = typeof input.new_string === 'string'

        if (hasFilePath && hasOldString && hasNewString) {
          // Auto-correct: wrap into edits array
          input = {
            edits: [
              {
                file_path: input.file_path,
                old_string: input.old_string,
                new_string: input.new_string,
              },
            ],
          }
        } else if (hasFilePath && hasOldString) {
          // Only file_path + old_string (missing new_string) — still try
          input = {
            edits: [
              {
                file_path: input.file_path,
                old_string: input.old_string,
                new_string: input.new_string || '',
              },
            ],
          }
        } else if (keys.length === 1 && hasFilePath) {
          // Only file_path — maybe they meant create file with empty content?
          input = { edits: [{ file_path: input.file_path, old_string: '', new_string: '' }] }
        } else if (keys.length === 2 && hasFilePath && typeof input.new_string === 'string') {
          // file_path + new_string but no old_string — treat as new file creation
          input = {
            edits: [{ file_path: input.file_path, old_string: '', new_string: input.new_string }],
          }
        } else {
          // Can't auto-correct — give helpful error with examples
          const example = hasFilePath
            ? `edit({ edits: [{ file_path: "${input.file_path}", old_string: "...", new_string: "..." }] })`
            : `edit({ edits: [{ file_path: "src/file.ts", old_string: "old", new_string: "new" }] })`
          return {
            success: false,
            output: '',
            error: `edit requires "edits" array. Received: ${JSON.stringify(rawInput)}. Usage: ${example}`,
          }
        }
      }

      const edits = input.edits as SingleEdit[]
      if (edits.length === 0) {
        return {
          success: false,
          output: '',
          error: `edits array is empty. Example: edit({ edits: [{ file_path: "src/file.ts", old_string: "old", new_string: "new" }] })`,
        }
      }

      const fileGroups = new Map<string, { edits: SingleEdit[]; originalContent: string | null }>()
      for (const e of edits) {
        const resolved = path.resolve(cwd, e.file_path)
        if (!fileGroups.has(resolved)) {
          let originalContent: string | null = null
          try {
            originalContent = fs.readFileSync(resolved, 'utf-8')
          } catch {
            /* file doesn't exist yet */
          }
          fileGroups.set(resolved, { edits: [], originalContent })
        }
        fileGroups.get(resolved)!.edits.push(e)
      }

      const results: string[] = []
      let anyFailed = false
      let firstError = ''
      const modifiedFiles = new Map<string, string | null>()

      for (const [resolved, group] of fileGroups) {
        const relPath = path.relative(cwd, resolved).replace(/\\/g, '/')
        let content =
          group.originalContent !== null ? group.originalContent.replace(/\r\n/g, '\n') : null

        for (let i = group.edits.length - 1; i >= 0; i--) {
          const e = group.edits[i]

          if (e.old_string === '') {
            if (content !== null) {
              const diag = JSON.stringify({
                file_path: e.file_path,
                old_string: '',
                new_string: e.new_string,
              })
              results.push(`  FAIL ${relPath}: File already exists — ${diag}`)
              if (!anyFailed) {
                anyFailed = true
                firstError = `File already exists: ${relPath} — ${diag}`
              }
              break
            }
            content = e.new_string
            results.push(`  Created ${relPath} (${e.new_string.split('\n').length} lines)`)
            continue
          }

          if (content === null) {
            const diag = JSON.stringify({
              file_path: e.file_path,
              old_string: e.old_string,
              new_string: e.new_string,
            })
            results.push(`  FAIL ${relPath}: File not found — ${diag}`)
            if (!anyFailed) {
              anyFailed = true
              firstError = `File not found: ${relPath} — ${diag}`
            }
            break
          }

          const idx = content.indexOf(e.old_string)
          if (idx === -1) {
            const diag = JSON.stringify({
              file_path: e.file_path,
              old_string: e.old_string,
              new_string: e.new_string,
            })
            results.push(`  FAIL ${relPath}: old_string not found — ${diag}`)
            if (!anyFailed) {
              anyFailed = true
              firstError = `old_string not found in ${relPath} — ${diag}`
            }
            break
          }
          const lastIdx = content.lastIndexOf(e.old_string)
          if (idx !== lastIdx) {
            const diag = JSON.stringify({
              file_path: e.file_path,
              old_string: e.old_string,
              new_string: e.new_string,
            })
            results.push(`  FAIL ${relPath}: old_string appears MULTIPLE times — ${diag}`)
            if (!anyFailed) {
              anyFailed = true
              firstError = `old_string appears MULTIPLE times in ${relPath} — ${diag}`
            }
            break
          }

          content = content.slice(0, idx) + e.new_string + content.slice(idx + e.old_string.length)
        }

        if (anyFailed) break
        modifiedFiles.set(resolved, content)
      }

      if (anyFailed) {
        for (const [filePath, group] of fileGroups) {
          const originalContent = group.originalContent
          if (originalContent === null) {
            try {
              fs.unlinkSync(filePath)
            } catch {
              /* ok */
            }
          } else {
            try {
              fs.mkdirSync(path.dirname(filePath), { recursive: true })
              fs.writeFileSync(filePath, originalContent, 'utf-8')
            } catch {
              /* ok */
            }
          }
          applier.markRead(filePath)
        }
        return {
          success: false,
          output: '',
          error: `Edit batch failed — all changes rolled back.\n${results.join('\n')}\n\nFirst error: ${firstError}`,
        }
      }

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
            error: `Failed to write ${path.relative(cwd, resolved).replace(/\\/g, '/')}: ${fmtErr(err)}. Input: ${JSON.stringify(rawInput)}`,
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
