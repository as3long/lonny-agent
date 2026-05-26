import { execSync } from 'node:child_process'
import { Tool, ToolResult } from './types.js'

export function createGrepTool(cwd: string): Tool {
  return {
    definition: {
      name: 'grep',
      description: 'Search file contents using a regular expression. Supports full regex syntax.',
      parameters: {
        pattern: { type: 'string', description: 'Regex pattern to search for', required: true },
        include: { type: 'string', description: 'File glob pattern to filter (e.g. "*.ts")' },
        path: { type: 'string', description: 'Directory to search in (default: cwd)' },
      },
    },
    async execute(input): Promise<ToolResult> {
      const pattern = input.pattern as string
      if (!pattern) {
        return { success: false, output: '', error: 'pattern is required' }
      }

      const include = input.include as string | undefined
      const searchPath = input.path as string | undefined || cwd

      try {
        let cmd = `rg -n "${pattern.replace(/"/g, '\\"')}"`
        if (include) {
          cmd += ` -g "${include}"`
        }
        cmd += ` "${searchPath}"`

        const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
        return { success: true, output: output || 'No matches found.' }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('exit code 1')) {
          return { success: true, output: 'No matches found.' }
        }
        return { success: false, output: '', error: `Grep failed: ${msg}` }
      }
    },
  }
}