import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { FileReadTracker } from '../diff/apply.js'
import { fmtErr } from './errors.js'

function formatWithLineNumbers(content: string): string {
  const lines = content.split('\n')
  // Drop trailing empty element produced by a final \n so the displayed
  // line count matches the actual line count of the file.
  const hasTrailingNewline = lines.length > 0 && lines[lines.length - 1] === ''
  const body = hasTrailingNewline ? lines.slice(0, -1) : lines
  const pad = String(body.length).length
  return body.map((l, i) => `${String(i + 1).padStart(pad, ' ')}: ${l}`).join('\n')
}

export function createReadTool(applier: FileReadTracker, cwd: string): Tool {
  return {
    definition: {
      name: 'read',
      description: 'Read the contents of one or more files. Always read a file before editing it. Each line is prefixed with "<lineNumber>: " for accurate line references; the prefix is a display aid only — do NOT include it in batch_edit patch content.',
      parameters: {
        paths: { type: 'array', description: 'File paths to read', required: true },
      },
    },
    async execute(input): Promise<ToolResult> {
      const paths = input.paths as string[]
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return { success: false, output: '', error: 'paths must be a non-empty array' }
      }

      const results: string[] = []
      for (const filePath of paths) {
        try {
          const resolved = path.resolve(cwd, filePath)
          const stat = await fs.stat(resolved)
          if (!stat.isFile()) {
            results.push(`=== ${filePath} ===\n(error: not a file)`)
            continue
          }
          if (stat.size > 1_000_000) {
            results.push(`=== ${filePath} ===\n(error: file too large (>1MB), use bash to read it selectively)`)
            continue
          }
          const content = await fs.readFile(resolved, 'utf-8')
          applier.markRead(resolved)
          results.push(`=== ${filePath} ===\n${formatWithLineNumbers(content)}`)
        } catch (err) {
          results.push(`=== ${filePath} ===\n(error: ${fmtErr(err)})`)
        }
      }

      return { success: true, output: results.join('\n\n') }
    },
  }
}