import * as fs from 'node:fs'

export interface TodoItem {
  text: string
  done: boolean
}

export class TodoPanel {
  todos: TodoItem[] = []

  loadFromFile(filePath: string): void {
    this.todos = []
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      this.todos = parseTodos(content)
    } catch { /* file not found or unreadable */ }
  }

  loadFromContent(content: string): void {
    this.todos = parseTodos(content)
  }

  render(height: number, width: number): string[] {
    const GR = '\x1b[32m'
    const RS = '\x1b[0m'
    const lines: string[] = []
    for (let i = 0; i < height; i++) {
      if (i < this.todos.length) {
        const t = this.todos[i]
        const prefix = t.done ? `${GR}✔${RS}` : '\u25a2'
        const text = t.text.length > width - 6 ? t.text.slice(0, width - 9) + '\u2026' : t.text
        const color = t.done ? GR : ''
        const line = ` ${prefix} ${color}${text}${t.done ? RS : ''}`
        lines.push(line + ' '.repeat(Math.max(0, width - visibleLength(line))))
      } else {
        lines.push(' '.repeat(width))
      }
    }
    return lines
  }
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').length
}

function parseTodos(markdown: string): TodoItem[] {
  const todos: TodoItem[] = []
  const lines = markdown.split('\n')
  let inTodoSection = false

  for (const line of lines) {
    if (line.startsWith('## Todo List')) {
      inTodoSection = true
      continue
    }
    if (inTodoSection && line.startsWith('## ')) {
      break
    }
    if (inTodoSection) {
      const trimmed = line.trim()
      const m = trimmed.match(/^- \[([ x])\]\s+(.+)/)
      if (m) {
        todos.push({
          text: m[2],
          done: m[1] === 'x',
        })
      }
    }
  }
  return todos
}
