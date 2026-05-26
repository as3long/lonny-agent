import * as fs from 'node:fs'

export interface TodoItem {
  text: string
  checked: boolean
  lineIndex: number
}

export class TodosPanel {
  private todos: TodoItem[] = []
  private currentFile: string | null = null

  /** Load and parse a plan file for todo items */
  loadPlan(filePath: string): TodoItem[] {
    this.currentFile = filePath
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      this.todos = this.parseTodos(content)
    } catch {
      this.todos = []
    }
    return this.todos
  }

  private parseTodos(content: string): TodoItem[] {
    const lines = content.split('\n')
    const items: TodoItem[] = []
    let inTodoSection = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Detect todo section header
      if (/^##\s+Todo/i.test(line) || /^##\s+Todo\s+List/i.test(line)) {
        inTodoSection = true
        continue
      }

      // Stop at next section
      if (inTodoSection && /^##\s/.test(line) && !/^##\s+Todo/i.test(line)) {
        inTodoSection = false
        continue
      }

      if (inTodoSection) {
        const uncheckedMatch = line.match(/^\s*-\s*\[\s*\]\s*(.+)/)
        const checkedMatch = line.match(/^\s*-\s*\[\s*x\s*\]\s*(.+)/i)

        if (uncheckedMatch) {
          items.push({ text: uncheckedMatch[1].trim(), checked: false, lineIndex: i })
        } else if (checkedMatch) {
          items.push({ text: checkedMatch[1].trim(), checked: true, lineIndex: i })
        }
      }
    }

    // Fallback: if no todo section detected, scan the whole file
    if (items.length === 0) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const uncheckedMatch = line.match(/^\s*-\s*\[\s*\]\s*(.+)/)
        const checkedMatch = line.match(/^\s*-\s*\[\s*x\s*\]\s*(.+)/i)
        if (uncheckedMatch) {
          items.push({ text: uncheckedMatch[1].trim(), checked: false, lineIndex: i })
        } else if (checkedMatch) {
          items.push({ text: checkedMatch[1].trim(), checked: true, lineIndex: i })
        }
      }
    }

    return items
  }

  getTodos(): TodoItem[] {
    return this.todos
  }

  getFormattedItems(): string[] {
    if (!this.currentFile) {
      return ['{bold}Select a plan to view todos{/bold}']
    }
    if (this.todos.length === 0) {
      return ['{bold}No todo items found{/bold}']
    }
    return this.todos.map(t => {
      const checkbox = t.checked ? '{green-fg}[✔]{/green-fg}' : '{yellow-fg}[ ]{/yellow-fg}'
      const text = t.checked ? `{strikethrough}${t.text}{/strikethrough}` : t.text
      return `${checkbox} ${text}`
    })
  }

  getCurrentFile(): string | null {
    return this.currentFile
  }

  clear(): void {
    this.todos = []
    this.currentFile = null
  }
}
