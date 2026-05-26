import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { PatchApplier } from '../diff/apply.js'

export function createReadTool(applier: PatchApplier, cwd: string): Tool {
  return {
    definition: {
      name: 'read',
      description: 'Read the contents of one or more files. Always read a file before editing it.',
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
          const stat = fs.statSync(resolved)
          if (!stat.isFile()) {
            results.push(`=== ${filePath} ===\n(error: not a file)`)
            continue
          }
          if (stat.size > 1_000_000) {
            results.push(`=== ${filePath} ===\n(error: file too large (>1MB), use bash to read it selectively)`)
            continue
          }
          const content = fs.readFileSync(resolved, 'utf-8')
          applier.markRead(resolved)
          results.push(`=== ${filePath} ===\n${content}`)
        } catch (err) {
          results.push(`=== ${filePath} ===\n(error: ${err instanceof Error ? err.message : String(err)})`)
        }
      }

      return { success: true, output: results.join('\n\n') }
    },
  }
}