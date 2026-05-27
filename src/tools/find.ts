import { fmtErr } from './errors.js'
import type { Tool, ToolDefinition } from './types.js'

export const createFindTool = (cwd: string): Tool => {
  const definition: ToolDefinition = {
    name: 'find',
    description: 'Find files by name pattern. Uses glob internally. Returns matching file paths.',
    parameters: {
      pattern: {
        type: 'string',
        description: 'File name pattern to search for (e.g. "*.ts", "test*")',
        required: true,
      },
      path: {
        type: 'string',
        description: 'Directory to search in (default: cwd)',
        required: false,
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 50)',
        required: false,
      },
    },
  }

  const execute = async (
    input: Record<string, unknown>,
  ): Promise<{ success: boolean; output: string; error?: string }> => {
    const pattern = String(input.pattern || '')
    const searchPath = String(input.path || cwd)
    const maxResults = Number(input.maxResults || 50)

    if (!pattern) {
      return { success: false, output: '', error: 'pattern is required' }
    }

    try {
      // Use a simple recursive directory walk
      const { execSync } = await import('node:child_process')
      const isWindows = process.platform === 'win32'

      let cmd: string
      if (isWindows) {
        // On Windows, use PowerShell
        cmd = `powershell -Command "Get-ChildItem -Path '${searchPath.replace(/'/g, "''")}' -Recurse -Filter '${pattern.replace(/'/g, "''")}' | Select-Object -First ${maxResults} -ExpandProperty FullName"`
      } else {
        cmd = `find '${searchPath}' -name '${pattern}' -type f 2>/dev/null | head -${maxResults}`
      }

      const result = execSync(cmd, { encoding: 'utf-8', timeout: 10000 })
      const lines = result
        .trim()
        .split('\n')
        .filter(l => l.trim())

      if (lines.length === 0) {
        return { success: true, output: `No files matching "${pattern}" found in ${searchPath}` }
      }

      return { success: true, output: lines.join('\n') }
    } catch (err) {
      return { success: false, output: '', error: `find failed: ${fmtErr(err)}` }
    }
  }

  return { definition, execute }
}
