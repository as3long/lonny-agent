import * as fs from 'node:fs'
import * as path from 'node:path'
import { PLAN_DIR } from '../tools/write_plan.js'

export interface PlanFile {
  name: string
  filePath: string
  mtime: Date
}

export class PlansPanel {
  private cwd: string
  private plans: PlanFile[] = []
  private selectedIndex: number = 0
  private onSelectCallback: ((filePath: string) => void) | null = null

  constructor(cwd: string) {
    this.cwd = cwd
  }

  /** Scan .lonny/ for plan files, sorted by mtime descending */
  scan(): PlanFile[] {
    const planDir = path.resolve(this.cwd, PLAN_DIR)
    try {
      if (!fs.existsSync(planDir)) {
        this.plans = []
        return this.plans
      }
      const entries = fs.readdirSync(planDir, { withFileTypes: true })
      const mdFiles = entries
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => {
          const filePath = path.join(planDir, e.name)
          const stat = fs.statSync(filePath)
          return { name: e.name, filePath, mtime: stat.mtime }
        })
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      this.plans = mdFiles
      return this.plans
    } catch {
      this.plans = []
      return this.plans
    }
  }

  getPlans(): PlanFile[] {
    return this.plans
  }

  getSelectedIndex(): number {
    return this.selectedIndex
  }

  setSelectedIndex(index: number): void {
    this.selectedIndex = Math.max(0, Math.min(index, this.plans.length - 1))
  }

  getSelectedFile(): string | null {
    if (this.plans.length === 0 || this.selectedIndex >= this.plans.length) return null
    return this.plans[this.selectedIndex].filePath
  }

  onSelect(callback: (filePath: string) => void): void {
    this.onSelectCallback = callback
  }

  selectCurrent(): void {
    const fp = this.getSelectedFile()
    if (fp && this.onSelectCallback) {
      this.onSelectCallback(fp)
    }
  }

  getFormattedItems(): string[] {
    if (this.plans.length === 0) {
      return ['{bold}No plans yet{/bold}']
    }
    return this.plans.map((p, i) => {
      const prefix = i === this.selectedIndex ? '{bold}▶ {/bold}' : '  '
      const dateStr = p.mtime.toLocaleDateString()
      return `${prefix}{bold}${p.name}{/bold} {gray-fg}${dateStr}{/gray-fg}`
    })
  }
}
