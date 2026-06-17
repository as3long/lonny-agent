import * as fs from 'node:fs'
import type { Component } from '../../pi-tui/index.js'
import { visibleLen } from '../utils.js'
import { colors } from './colors.js'
import { listPlans, type PlanEntry } from './plan-utils.js'

export class TodoPanel implements Component {
  private cwd: string
  private todos: { text: string; done: boolean }[] = []
  private planName: string = ''
  private dirty: boolean = true

  constructor(cwd: string) {
    this.cwd = cwd
  }

  refresh(): void {
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  private load(): void {
    this.dirty = false
    const plans = listPlans(this.cwd)
    if (plans.length === 0) {
      this.todos = []
      this.planName = ''
      return
    }
    const plan = plans[0]
    this.planName = plan.name
    this.todos = []
    try {
      const content = fs.readFileSync(plan.fullPath, 'utf-8')
      const lines = content.split('\n')
      let inTodo = false
      for (const line of lines) {
        if (line.startsWith('## Todo List')) {
          inTodo = true
          continue
        }
        if (inTodo && line.startsWith('## ')) break
        if (inTodo) {
          const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
          if (m) {
            this.todos.push({ text: m[2], done: m[1] === 'x' })
          }
        }
      }
    } catch {
      // ignore file read errors
    }
  }

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    if (this.dirty) this.load()

    const lines: string[] = []

    const headerText = ` ${colors.accent('\u25B6')} TODO`
    const headerPadding = Math.max(0, width - this.visibleLen(headerText))
    lines.push(colors.bgDark(headerText + ' '.repeat(headerPadding)))

    lines.push(colors.separator('\u2500'.repeat(width)))

    if (!this.planName) {
      lines.push(colors.dim('  (no plan)'))
      return lines
    }

    if (this.todos.length === 0) {
      lines.push(colors.dim('  (no todos)'))
      return lines
    }

    const contentWidth = width - 3
    for (const todo of this.todos) {
      const icon = todo.done ? '\u2705' : '\u2B1C'
      const textStyle = todo.done ? colors.doneTodo : colors.todo
      const text = todo.text
      const maxTextLen = contentWidth - 1
      let truncated = text
      let textVisLen = this.visibleLen(textStyle(text))
      if (textVisLen > maxTextLen) {
        truncated = `${text.slice(0, maxTextLen - 1)}\u2026`
        textVisLen = maxTextLen
      }
      const line = ` ${icon} ${textStyle(truncated)}`
      const visLen = this.visibleLen(line)
      const padding = Math.max(0, width - visLen)
      lines.push(line + ' '.repeat(padding))
    }

    return lines
  }
}
