import type { SessionOutput } from './session.js'

// ── Terminal ANSI colors ──────────────────────────────────────────────────────

const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const RE = '\x1b[31m'
const MG = '\x1b[35m'
const GY = '\x1b[90m'
const RS = '\x1b[0m'
const BLD = '\x1b[1m'
const TH = '\x1b[48;2;22;22;32m\x1b[38;2;150;150;170m'

export { BLD, CY, GR, GY, MG, RE, RS, TH, YE }

export const THINK_START_MARKER = '\x1b]0;THINK_START\x07'
export const THINK_END_MARKER = '\x1b]0;THINK_END\x07'

/** Write text to output (TUI/EventBus) or fallback to stdout (terminal). */
export function writeOut(text: string, output?: SessionOutput): void {
  if (output) {
    output.write(text)
  } else {
    process.stdout.write(text)
  }
}
