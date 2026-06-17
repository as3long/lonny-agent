import type { Component } from '../../pi-tui/index.js'
import { colors } from './colors.js'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export { formatTokens }

export class HeaderBar implements Component {
  private mode: string
  private model: string
  private provider: string
  private agentStatus: 'running' | 'idle'
  private planCount: number
  private planName: string
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private projectName: string = ''

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
    this.mode = 'code'
    this.agentStatus = 'idle'
    this.planCount = 0
    this.planName = ''
  }

  setMode(m: string): void {
    this.mode = m
  }
  setAgentStatus(s: 'running' | 'idle'): void {
    this.agentStatus = s
  }
  setPlanCount(n: number): void {
    this.planCount = n
  }
  setPlanName(n: string): void {
    this.planName = n
  }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setProjectName(name: string): void {
    this.projectName = name
  }
  invalidate(): void {}
  handleInput?(_data: string): void {}

  render(width: number): string[] {
    const appName = colors.accent('\u2588 lonny')
    const statusDot =
      this.agentStatus === 'running' ? colors.running('\u25CF') : colors.dim('\u25CB')
    const statusLabel =
      this.agentStatus === 'running' ? colors.running('running') : colors.dim('idle')
    const modeLabel =
      this.mode === 'ask'
        ? colors.success(this.mode)
        : this.mode === 'loop'
          ? colors.accent(this.mode)
          : colors.warn(this.mode)
    const modelInfo = colors.dim(`${this.provider}/${this.model}`)

    let rightPart = `${statusDot} ${statusLabel}  ${modeLabel}  ${modelInfo}`

    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${this.totalInputTokens} \u25BE${this.totalOutputTokens}  ${totalTokens}`
      const callsStr = `${this.totalApiCalls} calls`
      const projectTag = this.projectName ? `${this.projectName} ` : ''
      rightPart += `  ${colors.dim('|')}  ${colors.dim(`${projectTag}${tokenStr}  ${callsStr}`)}`
    }

    if (this.planCount > 0) {
      rightPart += `  ${colors.dim('|')}  ${colors.accent(`${this.planCount} plan${this.planCount > 1 ? 's' : ''}`)}`
      if (this.planName) rightPart += ` ${colors.dim(this.planName)}`
    }

    const line = ` ${appName}  ${colors.dim('·')}  ${rightPart}`
    return [colors.headerBg(line), colors.dim('\u2500'.repeat(width))]
  }
}
