import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'

export function createSaveMemoryTool(cwd: string): Tool {
  return {
    definition: {
      name: 'save_memory',
      category: 'Memory',
      group: 'Write',
      description:
        'Save a memory entry to .lonny/memory as a JSON file (content: string, tags?: string[])',
      parameters: {
        content: { type: 'string', description: 'Memory text', required: true },
        tags: { type: 'array', description: 'Optional tags', required: false },
      },
    },
    async execute(input): Promise<ToolResult> {
      try {
        const content = (input as any).content || input
        const tags = (input as any).tags
        if (typeof content !== 'string' || !content) {
          return { success: false, output: '', error: 'content is required (string)' }
        }
        const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
        const entry = {
          id,
          createdAt: new Date().toISOString(),
          content,
          tags: Array.isArray(tags) ? tags : undefined,
        }
        const dir = path.resolve(cwd, '.lonny', 'memory')
        try {
          fs.mkdirSync(dir, { recursive: true })
        } catch {}
        const file = path.join(dir, `${id}.json`)
        fs.writeFileSync(file, JSON.stringify(entry, null, 2), 'utf-8')
        return { success: true, output: `Saved memory ${id}` }
      } catch (err) {
        return { success: false, output: '', error: fmtErr(err) }
      }
    },
  }
}
