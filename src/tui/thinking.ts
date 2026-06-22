import { THINK_END_MARKER, THINK_START_MARKER } from '../agent/session-display.js'

export const THINK_START_TAG = '\n[THINK]\n'
export const THINK_END_TAG = '\n[/THINK]\n'

export function processThinkingBlocks(text: string): string {
  let result = text.replace(/\x1b\[[0-9;]*m/g, '')
  if (result.includes(THINK_START_MARKER)) {
    result = result
      .split(THINK_START_MARKER)
      .join(THINK_START_TAG)
      .split(THINK_END_MARKER)
      .join(THINK_END_TAG)
      .replace(/^[ \t]*[│╰╭─]/gm, line => line.replace(/[│╰╭─]/g, ' '))
  }
  return result
}
