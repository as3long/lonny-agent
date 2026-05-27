import { glob } from 'node:fs/promises'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

export const globTool: Tool = {
  definition: {
    name: 'glob',
    description: 'Find files by glob pattern (e.g. "src/**/*.ts"). Returns matching file paths.',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern to search for', required: true },
    },
  },
  async execute(input): Promise<ToolResult> {
    const pattern = input.pattern as string
    if (!pattern) {
      return { success: false, output: '', error: 'pattern is required' }
    }

    try {
      const results: string[] = []
      for await (const entry of glob(pattern)) {
        results.push(entry)
      }

      if (results.length === 0) {
        return { success: true, output: 'No files matched the pattern.' }
      }

      return { success: true, output: results.sort().join('\n') }
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Glob failed: ${fmtErr(err)}`,
      }
    }
  },
}
