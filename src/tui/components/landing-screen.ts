import type { Component } from '../../pi-tui/index.js'
import { visibleLen } from '../utils.js'
import { APP_VERSION, colors } from './colors.js'
import { PIXEL_LOGO_WIDTH, renderPixelLogo } from './pixel-logo.js'

export class LandingScreen implements Component {
  onSubmit?: (value: string) => void
  private model: string
  private provider: string

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data && this.onSubmit) {
      this.onSubmit(data)
    }
  }

  private visibleLen(s: string): number {
    return visibleLen(s)
  }

  render(width: number): string[] {
    const lines: string[] = []
    const center = (text: string, totalWidth: number): string => {
      const textWidth = this.visibleLen(text)
      const pad = Math.max(0, Math.floor((totalWidth - textWidth) / 2))
      return ' '.repeat(pad) + text
    }

    const logoLines = renderPixelLogo()
    const logoPad = Math.max(0, Math.floor((width - PIXEL_LOGO_WIDTH) / 2))
    const padStr = ' '.repeat(logoPad)

    for (const line of logoLines) {
      lines.push(padStr + line)
    }

    const divider = colors.dim('\u2500'.repeat(Math.min(36, width - 4)))
    lines.push(center(divider, width))

    lines.push('')
    const prompt =
      colors.dim('Type a message and press ') + colors.accent('Enter') + colors.dim(' to start')
    lines.push(center(prompt, width))
    lines.push('')

    const cmds = [
      colors.inputPrompt('/mode'),
      colors.inputPrompt('/model'),
      colors.inputPrompt('/plans'),
      colors.inputPrompt('/help'),
    ].join(colors.dim('  \u00B7  '))
    lines.push(center(colors.dim('Commands: ') + cmds, width))

    const modelInfo = colors.dim(`${this.provider}/${this.model}`)
    const versionInfo = colors.dim(`v${APP_VERSION}`)
    lines.push(center(modelInfo + colors.separator('  \u2502  ') + versionInfo, width))

    return lines
  }
}
