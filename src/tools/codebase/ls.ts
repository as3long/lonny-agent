import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'

export function createLsTool(cwd: string): Tool {
  return {
    definition: {
      name: 'ls',
      category: 'Codebase',
      group: 'List',
      description: 'List files and directories at a given path.',
      parameters: {
        path: { type: 'string', description: 'Directory path to list (default: cwd)' },
      },
    },
    async execute(input): Promise<ToolResult> {
      const rawPath = input.path as string | undefined
      if (rawPath && typeof rawPath !== 'string') {
        return { success: false, output: '', error: 'path must be a string' }
      }
      const dirPath = rawPath ? path.resolve(cwd, rawPath) : cwd

      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })
        const lines = entries.map(e => {
          const suffix = e.isDirectory() ? '/' : ''
          return `${e.name}${suffix}`
        })
        return { success: true, output: lines.sort().join('\n') }
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `Failed to list directory: ${fmtErr(err)}`,
        }
      }
    },
  }
}
