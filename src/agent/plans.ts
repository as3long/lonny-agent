import * as fs from 'node:fs'
import * as path from 'node:path'

const PLAN_DIR = '.lonny'

export interface PlanFile {
  /** File name (e.g. "backend-api.md") */
  name: string
  /** Full file path */
  fullPath: string
  /** Last modified timestamp */
  mtime: number
  /** Plan description / summary (first few lines of ## Plan section) */
  description: string
  /** Total number of todo items */
  totalItems: number
  /** Number of completed todo items */
  doneItems: number
  /** Number of pending todo items */
  pendingItems: number
  /** The todo lines as formatted markdown */
  todoList: string
  /** Whether this plan has pending work */
  hasPending: boolean
}

/**
 * Scan `.lonny/*.md` files and find plan documents.
 * A plan is any markdown file containing a `## Todo List` section.
 * Returns plans sorted by mtime (most recent first).
 */
export function scanPlans(cwd: string): PlanFile[] {
  const planDir = path.resolve(cwd, PLAN_DIR)
  try {
    if (!fs.existsSync(planDir)) return []
    const files = fs.readdirSync(planDir)
    const plans: PlanFile[] = []

    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const fullPath = path.join(planDir, f)
      let mtime = 0
      try {
        mtime = fs.statSync(fullPath).mtimeMs
      } catch {
        /* ignore */
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8')
        const plan = parsePlanFile(f, fullPath, mtime, content)
        if (plan) plans.push(plan)
      } catch {
        /* ignore parse errors */
      }
    }

    plans.sort((a, b) => b.mtime - a.mtime)
    return plans
  } catch {
    return []
  }
}

/**
 * Parse a single markdown plan file.
 * Returns null if the file doesn't contain a ## Todo List section.
 */
function parsePlanFile(
  name: string,
  fullPath: string,
  mtime: number,
  content: string,
): PlanFile | null {
  const lines = content.split('\n')

  // Extract description from ## Plan section (first non-empty line after the heading)
  let description = ''
  let inPlanSection = false
  const todoItems: string[] = []
  let inTodoSection = false

  for (const raw of lines) {
    const trimmed = raw.trim()

    // Detect sections
    if (/^##\s+Plan\b/i.test(trimmed)) {
      inPlanSection = true
      continue
    }
    if (/^##\s+(Todo\s*List|Todo\b|To-do|TODO)/i.test(trimmed)) {
      inPlanSection = false
      inTodoSection = true
      continue
    }
    // Stop if we hit another ## section
    if (/^##\s/.test(trimmed) && !/^##\s+(Plan|Todo|To-do)/i.test(trimmed)) {
      inPlanSection = false
      inTodoSection = false
      continue
    }

    if (inPlanSection && !description && trimmed) {
      description = trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
    }

    if (inTodoSection) {
      const m = trimmed.match(/^- \[([ x])\]\s+(.+)/)
      if (m) {
        todoItems.push(m[0])
      }
    }
  }

  // Must have a todo list to be considered a plan
  if (todoItems.length === 0) return null

  const doneItems = todoItems.filter(t => t.includes('- [x]')).length
  const totalItems = todoItems.length
  const pendingItems = totalItems - doneItems

  // Build a clean todo list string (only pending items + count of done)
  let todoList = ''
  for (const item of todoItems) {
    if (item.includes('- [ ]')) {
      todoList += `  ${item}\n`
    }
  }
  if (doneItems > 0) {
    todoList += `  (${doneItems}/${totalItems} items completed)\n`
  }

  return {
    name: name.replace(/\.md$/, ''),
    fullPath,
    mtime,
    description,
    totalItems,
    doneItems,
    pendingItems,
    todoList,
    hasPending: pendingItems > 0,
  }
}

/**
 * Format active plans as a prompt section for inclusion in the system prompt.
 * Returns empty string if no active plans with pending work exist.
 */
export function formatActivePlanForPrompt(cwd: string): string {
  const plans = scanPlans(cwd).filter(p => p.hasPending)
  if (plans.length === 0) return ''

  const parts: string[] = []
  parts.push('\n## Active Plan')

  for (const plan of plans) {
    parts.push(`\n### ${plan.name}`)
    if (plan.description) {
      parts.push(`\n${plan.description}`)
    }
    parts.push(`\n### Remaining Todo (${plan.pendingItems}/${plan.totalItems})\n`)
    parts.push(plan.todoList)
  }

  // Add the rule about updating plan files
  parts.push(`
### Usage
- After completing a task item, use \`edit\` to update the corresponding plan file in \`.lonny/\` by checking off the TODO item (change \`- [ ]\` to \`- [x]\`).
- When all items are complete, end with a summary and switch to review mode (\`/mode review\`) for quality checks.`)

  return parts.join('\n')
}
