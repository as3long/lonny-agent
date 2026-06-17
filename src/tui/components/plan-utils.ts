import * as fs from 'node:fs'
import * as path from 'node:path'
import type { SelectItem } from '../../pi-tui/index.js'
import { PLAN_DIR } from '../../tools/edit/write_plan.js'
import { colors } from './colors.js'

export interface PlanEntry {
  name: string
  description: string
  fullPath: string
  mtime: number
}

export function listPlans(cwd: string): PlanEntry[] {
  const planDir = path.resolve(cwd, PLAN_DIR)
  try {
    const files = fs.readdirSync(planDir)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(planDir, f)
        let mtime = 0
        try {
          mtime = fs.statSync(fullPath).mtimeMs
        } catch {
          /* ignore */
        }
        return {
          name: f.replace(/\.md$/, ''),
          description: f,
          fullPath,
          mtime,
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

export function loadTodos(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const todos: string[] = []
    let inTodo = false
    for (const raw of lines) {
      const line = raw.trim()
      if (/^##\s+todo/i.test(line)) {
        inTodo = true
        continue
      }
      if (inTodo && /^##\s/.test(line)) break
      if (inTodo) {
        const m = line.match(/^- \[([ x])\]\s+(.+)/)
        if (m) {
          const done = m[1] === 'x'
          const check = done ? '\u2705' : '\u2B1C'
          todos.push(`${check} ${done ? colors.doneTodo(m[2]) : colors.todo(m[2])}`)
        }
      }
    }
    return todos.length > 0 ? todos.join('\n') : '(no todo items)'
  } catch {
    return '(no plan selected)'
  }
}

export function plansToItems(plans: PlanEntry[]): SelectItem[] {
  return plans.map(p => ({
    value: p.name,
    label: p.name,
    description: p.mtime
      ? `${new Date(p.mtime).toLocaleDateString()} ${new Date(p.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : '',
  }))
}
