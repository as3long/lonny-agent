import { colors } from './colors.js'

const PIXEL_FONT: Record<string, string[]> = {
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
  D: ['███  ', '█  █ ', '█   █', '█  █ ', '███  '],
  E: ['█████', '█    ', '███  ', '█    ', '█████'],
}

const LONNY_CHARS = ['L', 'O', 'N', 'N', 'Y']
const CODE_CHARS = ['C', 'O', 'D', 'E']

const PIXEL_LOGO_WIDTH = 54

export { PIXEL_LOGO_WIDTH }

function renderPixelLogo(): string[] {
  const midGray = '\x1b[38;2;160;160;160m'
  const brightWhite = '\x1b[38;2;255;255;255m'
  const reset = '\x1b[0m'
  const lines: string[] = []
  for (let row = 0; row < 5; row++) {
    const lonnyPart = LONNY_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    const codePart = CODE_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    lines.push(`${midGray + lonnyPart}  ${brightWhite}${codePart}${reset}`)
  }
  return lines
}

export { renderPixelLogo }
