import { computeDiff } from './diff-compute.js'
import type { DiffLine } from './types.js'

// ── ANSI colors for terminal output ───────────────────────────────────────
const DIFF_RED = '\x1b[38;2;255;80;80m'
const DIFF_GREEN = '\x1b[38;2;0;200;100m'
const DIFF_DIM = '\x1b[38;2;100;100;100m'
const DIFF_RESET = '\x1b[0m'

// ── Colors for HTML output ────────────────────────────────────────────────
const HTML_RED = '#ff5050'
const HTML_GREEN = '#00c864'
const HTML_DIM = '#888888'

/** Terminal renderer — unified-diff format with color */
export function renderDiffTerminal(lines: DiffLine[], startLineNum?: number): string {
  if (lines.length === 0) return ''

  const output: string[] = []
  let oldLn = startLineNum ?? 1
  let newLn = startLineNum ?? 1
  for (const line of lines) {
    if (line.type === 'delete') {
      output.push(`  ${DIFF_RED}- ${oldLn}  ${line.content}${DIFF_RESET}`)
      oldLn++
    } else if (line.type === 'insert') {
      output.push(`  ${DIFF_GREEN}+ ${newLn}  ${line.content}${DIFF_RESET}`)
      newLn++
    } else {
      output.push(`  ${DIFF_DIM}  ${oldLn}  ${line.content}${DIFF_RESET}`)
      oldLn++
      newLn++
    }
  }
  return output.join('\n')
}

/** HTML renderer for web output */
export function renderDiffHtml(lines: DiffLine[]): string {
  if (lines.length === 0) return ''

  const output: string[] = []
  for (const line of lines) {
    if (line.type === 'delete') {
      output.push(`  <span style="color: ${HTML_RED};">- ${escapeHtml(line.content)}</span>`)
    } else if (line.type === 'insert') {
      output.push(`  <span style="color: ${HTML_GREEN};">+ ${escapeHtml(line.content)}</span>`)
    } else {
      output.push(`  <span style="color: ${HTML_DIM};">  ${escapeHtml(line.content)}</span>`)
    }
  }
  return output.join('\n')
}

/** Escape HTML special characters */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Generate diff output using jest-diff.
 * Returns terminal-colored unified-diff format with line numbers.
 */
export function generateDiff(oldStr: string, newStr: string, startLineNum?: number): string {
  const lines = computeDiff(oldStr, newStr)
  return renderDiffTerminal(lines, startLineNum)
}

/**
 * Generate diff with surrounding context lines (1 before, 1 after)
 * and line numbers. Context lines are extracted from the full file content.
 */
export function generateDiffWithContext(
  fullContent: string,
  oldStr: string,
  newStr: string,
  matchIndex: number,
  matchLength: number,
): string {
  // Calculate 1-based line number of the first matched line
  const firstLineNum = fullContent.slice(0, matchIndex).split('\n').length

  const contentLines = fullContent.split('\n')

  // Find 0-based line index where matchIndex falls
  let charPos = 0
  let matchStartLineIdx = 0
  for (let i = 0; i < contentLines.length; i++) {
    if (charPos <= matchIndex && matchIndex < charPos + contentLines[i].length + 1) {
      matchStartLineIdx = i
      break
    }
    charPos += contentLines[i].length + 1 // +1 for \n
  }

  // How many lines does oldStr span in the original content?
  const oldLines = oldStr === '' ? [] : oldStr.split('\n')
  const oldLineCount = oldLines.length
  const matchEndLineIdx = matchStartLineIdx + oldLineCount - 1

  // Context before (1 line) and after (1 line)
  const beforeLineIdx = matchStartLineIdx > 0 ? matchStartLineIdx - 1 : -1
  const afterLineIdx = matchEndLineIdx < contentLines.length - 1 ? matchEndLineIdx + 1 : -1

  // Compute diff between oldStr and newStr
  const diffLines = computeDiff(oldStr, newStr)

  const output: string[] = []

  // Context before
  if (beforeLineIdx !== -1) {
    const lineNum = beforeLineIdx + 1
    output.push(`  ${DIFF_DIM}  ${lineNum}  ${contentLines[beforeLineIdx]}${DIFF_RESET}`)
  }

  // Diff lines with line numbers
  let oldLn = firstLineNum
  let newLn = firstLineNum
  for (const line of diffLines) {
    if (line.type === 'delete') {
      output.push(`  ${DIFF_RED}- ${oldLn}  ${line.content}${DIFF_RESET}`)
      oldLn++
    } else if (line.type === 'insert') {
      output.push(`  ${DIFF_GREEN}+ ${newLn}  ${line.content}${DIFF_RESET}`)
      newLn++
    } else {
      output.push(`  ${DIFF_DIM}  ${oldLn}  ${line.content}${DIFF_RESET}`)
      oldLn++
      newLn++
    }
  }

  // Context after
  if (afterLineIdx !== -1) {
    const lineNum = afterLineIdx + 1
    output.push(`  ${DIFF_DIM}  ${lineNum}  ${contentLines[afterLineIdx]}${DIFF_RESET}`)
  }

  return output.join('\n')
}
