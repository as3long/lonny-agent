import * as fs from 'node:fs'
import * as path from 'node:path'
import { PLAN_DIR } from '../tools/write_plan.js'

export interface PlanEntry {
  filename: string
  display: string
  mtime: number
  fullPath: string
}

export class PlansPanel {
  plans: PlanEntry[] = []
  selectedIndex = -1
  private onSelect?: (plan: PlanEntry) => void
  private cwd: string

  constructor(cwd: string) {
    this.cwd = cwd
  }

  setOnSelect(cb: (plan: PlanEntry) => void): void {
    this.onSelect = cb
  }

  refresh(): void {
    const planDir = path.resolve(this.cwd, PLAN_DIR)
    try {
      const files = fs.readdirSync(planDir)
      this.plans = files
        .filter(f => f.endsWith('.md'))
        .map(f => {
          const fullPath = path.join(planDir, f)
          let mtime = 0
          try {
            mtime = fs.statSync(fullPath).mtimeMs
          } catch { /* ignore */ }
          return { filename: f, display: f.replace(/\.md$/, ''), mtime, fullPath }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      this.plans = []
    }
    if (this.selectedIndex >= this.plans.length) {
      this.selectedIndex = -1
    }
  }

  setSelectedByClick(row: number): void {
    if (row >= 0 && row < this.plans.length) {
      this.selectedIndex = row
      if (this.onSelect) this.onSelect(this.plans[row])
    }
  }

  getSelected(): PlanEntry | undefined {
    return this.selectedIndex >= 0 ? this.plans[this.selectedIndex] : undefined
  }

  render(height: number, width: number): string[] {
    const REV = '\x1b[7m'
    const RS = '\x1b[0m'
    const lines: string[] = []
    for (let i = 0; i < height; i++) {
      if (i < this.plans.length) {
        const p = this.plans[i]
        const display = p.display.length > width - 2 ? p.display.slice(0, width - 3) + '\u2026' : p.display
        if (i === this.selectedIndex) {
          lines.push(REV + ' ' + display + ' '.repeat(Math.max(0, width - display.length - 1)) + RS)
        } else {
          lines.push(' ' + display + ' '.repeat(Math.max(0, width - display.length - 1)))
        }
      } else {
        lines.push(' '.repeat(width))
      }
    }
    return lines
  }
}
