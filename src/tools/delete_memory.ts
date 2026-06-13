import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

export function createDeleteMemoryTool(cwd: string): Tool {
  return {
    definition: {
      name: 'delete_memory',
      category: 'Memory',
      group: 'Manage',
      description:
        'Delete a memory entry by id or filename under .lonny/memory (id or file parameter)',
      parameters: {
        id: {
          type: 'string',
          description: 'Memory id (filename without .json) or relative filename',
          required: true,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      try {
        const id = (input as any).id || input
        if (typeof id !== 'string' || !id)
          return { success: false, output: '', error: 'id is required (string)' }
        const dir = path.resolve(cwd, '.lonny', 'memory')
        const candidates = [id, `${id}.json`]
        for (const c of candidates) {
          const p = path.join(dir, c)
          try {
            if (fs.existsSync(p)) {
              fs.unlinkSync(p)
              return { success: true, output: `Deleted memory ${c}` }
            }
          } catch (e) {
            return { success: false, output: '', error: fmtErr(e) }
          }
        }
        return { success: false, output: '', error: `Memory not found: ${id}` }
      } catch (err) {
        return { success: false, output: '', error: fmtErr(err) }
      }
    },
  }
}
