import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'

export function createListMemoryTool(cwd: string): Tool {
  return {
    definition: {
      name: 'list_memory',
      category: 'Memory',
      group: 'Query',
      description: 'List memory entries stored under .lonny/memory (optional limit param)',
      parameters: {
        limit: {
          type: 'number',
          description: 'Maximum number of entries to return',
          required: false,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      try {
        const limit = typeof (input as any).limit === 'number' ? (input as any).limit : undefined
        const dir = path.resolve(cwd, '.lonny', 'memory')
        if (!fs.existsSync(dir)) return { success: true, output: 'No memories found' }
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        const entries: { id: string; createdAt: string; preview: string; tags?: string[] }[] = []
        for (const f of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
            entries.push({
              id: data.id || f.replace(/\.json$/, ''),
              createdAt: data.createdAt || '',
              preview: (data.content || '').replace(/\n/g, ' ').slice(0, 200),
              tags: Array.isArray(data.tags) ? data.tags : undefined,
            })
          } catch {
            // ignore corrupted
          }
        }
        // sort by createdAt desc
        entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        const out = entries.slice(0, limit || entries.length).map(e => {
          const tagStr = e.tags ? ` [tags: ${e.tags.join(',')}]` : ''
          return `${e.id}  ${e.createdAt}  ${e.preview}${tagStr}`
        })
        return { success: true, output: out.join('\n') }
      } catch (err) {
        return { success: false, output: '', error: fmtErr(err) }
      }
    },
  }
}
