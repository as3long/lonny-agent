import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FileReadTracker } from '../../diff/apply.js'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'

// ── Configuration ─────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 1_000_000 // 1MB
const DEFAULT_MAX_LINES = 500 // Default pagination limit

/**
 * Format content with line numbers.
 * Handles trailing newline correctly.
 * Exported for testing and reuse.
 */
export function formatWithLineNumbers(content: string, startLine = 1): string {
  const lines = content.split('\n')
  // Drop trailing empty element produced by a final \n so the displayed
  // line count matches the actual line count of the file.
  const hasTrailingNewline = lines.length > 0 && lines[lines.length - 1] === ''
  const body = hasTrailingNewline ? lines.slice(0, -1) : lines
  const pad = String(startLine + body.length - 1).length
  return body.map((l, i) => `${String(startLine + i).padStart(pad, ' ')}: ${l}`).join('\n')
}

export function createReadTool(applier: FileReadTracker, cwd: string): Tool {
  return {
    definition: {
      name: 'read',
      category: 'Codebase',
      group: 'Read',
      description:
        'Read the contents of one or more files. Always read a file before editing it. Each line is prefixed with "<lineNumber>: " for accurate line references; the prefix is a display aid only — do NOT include it in batch_edit patch content. Supports pagination via startLine and maxLines for large files.',
      parameters: {
        paths: { type: 'array', description: 'File paths to read', required: true },
        startLine: { type: 'number', description: 'Start line number (1-based)', required: false },
        maxLines: {
          type: 'number',
          description: 'Maximum number of lines to read',
          required: false,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      const paths = input.paths as string[]
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return { success: false, output: '', error: 'paths must be a non-empty array' }
      }

      const startLine = typeof input.startLine === 'number' ? Math.max(1, input.startLine) : 1
      const maxLines =
        typeof input.maxLines === 'number' ? Math.max(1, input.maxLines) : DEFAULT_MAX_LINES

      // Read files in parallel
      const results = await Promise.all(
        paths.map(async (filePath): Promise<string> => {
          try {
            const resolved = path.resolve(cwd, filePath)
            const stat = await fs.stat(resolved)
            if (!stat.isFile()) {
              return `=== ${filePath} ===\n(error: not a file)`
            }
            if (stat.size > MAX_FILE_SIZE) {
              return `=== ${filePath} ===\n(error: file too large (>1MB), use bash to read it selectively)`
            }
            let content = await fs.readFile(resolved, 'utf-8')

            // Handle pagination
            const allLines = content.split('\n')
            const hasTrailingNewline = allLines.length > 0 && allLines[allLines.length - 1] === ''
            const totalLines = hasTrailingNewline ? allLines.length - 1 : allLines.length

            if (startLine > totalLines) {
              return `=== ${filePath} ===\n(error: startLine ${startLine} exceeds file length ${totalLines})`
            }

            const endLine = Math.min(startLine + maxLines - 1, totalLines)
            const selectedLines = allLines.slice(startLine - 1, endLine)
            content = selectedLines.join('\n') + (hasTrailingNewline ? '\n' : '')

            const displayStart = startLine
            const displayEnd = endLine
            const truncated =
              endLine < totalLines ? ` (lines ${displayStart}-${displayEnd} of ${totalLines})` : ''

            applier.markRead(resolved)
            return `=== ${filePath} ===${truncated}\n${formatWithLineNumbers(content, startLine)}`
          } catch (err) {
            return `=== ${filePath} ===\n(error: ${fmtErr(err)})`
          }
        }),
      )

      return { success: true, output: results.join('\n\n') }
    },
  }
}
