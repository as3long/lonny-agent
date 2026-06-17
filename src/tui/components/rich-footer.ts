import type { Component } from '../../pi-tui/index.js'
import { visibleLen } from '../utils.js'
import { APP_VERSION, colors, landingColors } from './colors.js'
import { formatTokens } from './header-bar.js'

export class RichFooter implements Component {
  private cwd: string
  private mode: string = 'code'
  private model: string = ''
  private provider: string = ''
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private balance: string = ''
  private webBalance: string = ''
  private visible = true
  private phase: 'landing' | 'chat' = 'landing'
  private agentStatus: 'running' | 'idle' = 'idle'

  constructor(cwd: string, model: string, provider: string) {
    this.cwd = cwd
    this.model = model
    this.provider = provider
  }

  setMode(m: string): void {
    this.mode = m
  }
  setModel(model: string, provider: string): void {
    this.model = model
    this.provider = provider
  }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setVisible(v: boolean): void {
    this.visible = v
  }
  setPhase(p: 'landing' | 'chat'): void {
    this.phase = p
  }
  setBalance(b: string): void {
    this.balance = b
  }
  setWebBalance(wb: string): void {
    this.webBalance = wb
  }
  setAgentStatus(s: 'running' | 'idle'): void {
    this.agentStatus = s
  }

  invalidate(): void {}
  handleInput?(_data: string): void {}

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    if (!this.visible || width < 40) return []

    const { statusBg, statusText, statusAccent, reset } = landingColors

    const dir = this.cwd.length > 30 ? `...${this.cwd.slice(-27)}` : this.cwd
    const leftPart = `${statusAccent}\u25A0${reset}${statusBg}${statusText} ${dir}${reset}`

    if (this.phase === 'landing') {
      const centerPart = `${statusBg + statusText}  ready  ${reset}`
      const rightPart = `${statusBg + statusText}v${APP_VERSION} ${reset}`
      const line = leftPart + centerPart + rightPart
      const visLen = this.visibleLen(line)
      const padded = visLen < width ? line + statusBg + ' '.repeat(width - visLen) + reset : line
      return [padded]
    }

    const segments: string[] = []

    const statusDot =
      this.agentStatus === 'running'
        ? `\x1b[38;2;0;255;100m\u25CF\x1b[0m`
        : `\x1b[38;2;150;150;150m\u25CB\x1b[0m`
    const statusLabel =
      this.agentStatus === 'running'
        ? `\x1b[38;2;0;255;100mrunning\x1b[0m`
        : `\x1b[38;2;150;150;150midle\x1b[0m`
    segments.push(`${statusDot} ${statusLabel}`)

    const modeTag =
      this.mode === 'plan'
        ? `\x1b[38;2;255;200;50m${this.mode}\x1b[0m`
        : this.mode === 'ask'
          ? `\x1b[38;2;0;200;100m${this.mode}\x1b[0m`
          : this.mode === 'loop'
            ? `\x1b[38;2;200;100;255m${this.mode}\x1b[0m`
            : `\x1b[38;2;0;200;255m${this.mode}\x1b[0m`
    segments.push(modeTag)

    if (this.model) {
      segments.push(`\x1b[38;2;110;110;110m${this.provider}/${this.model}\x1b[0m`)
    }

    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${formatTokens(this.totalInputTokens)} \u25BE${formatTokens(this.totalOutputTokens)}  ${formatTokens(totalTokens)}`
      segments.push(`\x1b[38;2;110;110;110m${tokenStr}\x1b[0m`)
      segments.push(`\x1b[38;2;110;110;110m${this.totalApiCalls}c\x1b[0m`)
    }

    if (this.webBalance) {
      segments.push(`\x1b[38;2;255;200;50m\u4F59\u989D\x1b[0m\uFF1A${this.webBalance}`)
    } else if (this.balance) {
      segments.push(`\x1b[38;2;255;200;50m\u4F59\u989D\x1b[0m\uFF1A${this.balance}`)
    }

    const separator = `${statusBg} \x1b[38;2;60;60;60m\u2502\x1b[0m ${reset}`
    const centerContent = `${statusBg + statusText}  ${segments.join(separator)}  ${reset}`

    const rightPart = `${statusBg + statusText}v${APP_VERSION} ${reset}`

    const line = leftPart + centerContent + rightPart

    const lineLen = line.length - 2 * statusBg.length - reset.length
    let result = line
    if (lineLen < width - 40) {
      const hints = [
        '\x1b[38;2;110;110;110m/mode\x1b[0m',
        '\x1b[38;2;110;110;110m/plans\x1b[0m',
        '\x1b[38;2;110;110;110m/help\x1b[0m',
        '\x1b[38;2;110;110;110m?\x1b[0m',
      ].join(' \x1b[38;2;60;60;60m\u00b7\x1b[0m ')
      const hintStr = `${statusBg + statusText}  ${hints}  ${reset}`
      const fullLine = line + hintStr
      const approxLen = fullLine.replace(/\x1b\[[0-9;]*m/g, '').length
      if (approxLen <= width) {
        result = fullLine
      }
    }

    const visLen = this.visibleLen(result)
    const padded = visLen < width ? result + statusBg + ' '.repeat(width - visLen) + reset : result

    return [padded]
  }
}
