import * as fs from 'node:fs'

function safeBg(text: string, bg: string): string {
  return `\x1b[${bg}m${text.replace(/\x1b\[0m/g, `\x1b[0m\x1b[${bg}m`)}\x1b[0m`
}

export { safeBg }

export const colors = {
  bgDark: (text: string) => safeBg(text, '48;2;30;30;30'),
  bgDim: (text: string) => safeBg(text, '48;2;25;25;25'),
  headerBg: (text: string) => safeBg(text, '48;2;170;170;170'),
  separator: (text: string) => `\x1b[38;2;60;60;60m${text}\x1b[0m`,
  statusBg: (text: string) => safeBg(text, '48;2;25;25;35'),
  running: (text: string) => `\x1b[38;2;0;255;100m${text}\x1b[0m`,
  idle: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  doneTodo: (text: string) => `\x1b[38;2;100;200;100m${text}\x1b[0m`,
  todo: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  accent: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[38;2;90;90;90m${text}\x1b[0m`,
  userLabel: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
  assistantLabel: (text: string) => `\x1b[38;2;0;255;150m${text}\x1b[0m`,
  error: (text: string) => `\x1b[38;2;255;80;80m${text}\x1b[0m`,
  success: (text: string) => `\x1b[38;2;0;200;100m${text}\x1b[0m`,
  inputPrompt: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  warn: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
}

const APP_VERSION: string = (() => {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    return JSON.parse(raw).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

export { APP_VERSION }

export const landingColors = {
  inputBg: '\x1b[48;2;35;35;35m',
  inputBorder: '\x1b[38;2;60;60;60m',
  cyanBar: '\x1b[38;2;0;200;255m',
  placeholderDim: '\x1b[38;2;130;130;130m',
  placeholderQuote: '\x1b[38;2;160;160;160m',
  inputText: '\x1b[38;2;220;220;220m',
  statusBg: '\x1b[48;2;18;18;18m',
  statusText: '\x1b[38;2;110;110;110m',
  statusAccent: '\x1b[38;2;0;170;255m',
  reset: '\x1b[0m',
}
