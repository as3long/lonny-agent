import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileReadTracker } from '../diff/apply.js'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

// ── Diff types ────────────────────────────────────────────────────────────
export type DiffLineType = 'old' | 'new'

export interface DiffLine {
  lineNum: number
  type: DiffLineType
  content: string
}

// ── ANSI colors for terminal output ───────────────────────────────────────
const DIFF_RED = '\x1b[38;2;255;80;80m'
const DIFF_GREEN = '\x1b[38;2;0;200;100m'
const DIFF_RESET = '\x1b[0m'

// ── ANSI colors for HTML output ───────────────────────────────────────────
const HTML_RED = '#ff5050'
const HTML_GREEN = '#00c864'

/** Build diagnostic JSON for error messages */
function buildDiag(edit: SingleEdit): string {
  return JSON.stringify({
    file_path: edit.file_path,
    old_string: edit.old_string,
    new_string: edit.new_string,
  })
}

/** Compute diff lines (pure data, no rendering) */
export function computeDiff(oldStr: string, newStr: string, startLine = 0): DiffLine[] {
  const oldLines = oldStr === '' ? [] : oldStr.split('\n')
  const newLines = newStr.split('\n')
  const lines: DiffLine[] = []

  for (let i = 0; i < oldLines.length; i++) {
    lines.push({ lineNum: startLine + i, type: 'old', content: oldLines[i] })
  }
  for (let i = 0; i < newLines.length; i++) {
    lines.push({ lineNum: startLine + i, type: 'new', content: newLines[i] })
  }

  return lines
}

/** Terminal renderer */
export function renderDiffTerminal(lines: DiffLine[]): string {
  if (lines.length === 0) return ''

  const maxLineNum = Math.max(...lines.map(l => l.lineNum))
  const lineNumWidth = String(maxLineNum).length
  const fmtLineNum = (n: number) => String(n).padStart(lineNumWidth, ' ')

  const output: string[] = []
  for (const line of lines) {
    const color = line.type === 'old' ? DIFF_RED : DIFF_GREEN
    const reset = DIFF_RESET
    output.push(`  ${fmtLineNum(line.lineNum)} ${color}${line.content}${reset}`)
  }
  return output.join('\n')
}

/** HTML renderer for web output */
export function renderDiffHtml(lines: DiffLine[]): string {
  if (lines.length === 0) return ''

  const maxLineNum = Math.max(...lines.map(l => l.lineNum))
  const lineNumWidth = String(maxLineNum).length
  const fmtLineNum = (n: number) => String(n).padStart(lineNumWidth, ' ')

  const output: string[] = []
  for (const line of lines) {
    const color = line.type === 'old' ? HTML_RED : HTML_GREEN
    const style = `color: ${color};`
    output.push(
      `  <span style="${style}">${fmtLineNum(line.lineNum)} ${escapeHtml(line.content)}</span>`,
    )
  }
  return output.join('\n')
}

/** Escape HTML special characters */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Generate diff output (backward compatible).
 * Delegates to terminal renderer by default.
 */
export function generateDiff(oldStr: string, newStr: string, startLine = 0): string {
  const lines = computeDiff(oldStr, newStr, startLine)
  return renderDiffTerminal(lines)
}

/**
 * Normalize a line for whitespace-tolerant comparison:
 * 1. Trim leading/trailing whitespace
 * 2. Collapse runs of 2+ spaces/tabs into a single space
 *
 * This handles whitespace differences ANYWHERE on the line:
 * - Leading/trailing spaces → `trim()` removes them
 * - Extra internal spaces → `"foo  bar"` → `"foo bar"`
 * - Blank lines with spaces → `"   "` → `""`
 */
function normalizeLine(s: string): string {
  return s.trim().replace(/[ \t]{2,}/g, ' ')
}

interface MatchPos {
  index: number
  length: number
}

/**
 * Sliding-window line search that ignores whitespace differences
 * (leading, trailing, and internal runs).
 *
 * Returns all match positions in the ORIGINAL (unnormalized) content,
 * so the caller can do content.slice(match.index, match.index + match.length)
 * to extract the actual matched text (with its original whitespace).
 */
function findAllLinesTolerant(content: string, oldString: string): MatchPos[] {
  if (oldString === '') return []

  const contentLines = content.split('\n')
  const oldLines = oldString.split('\n')

  if (oldLines.length > contentLines.length) return []

  // Pre-normalize for speed
  const normContent = contentLines.map(normalizeLine)
  const normOld = oldLines.map(normalizeLine)

  const matches: MatchPos[] = []

  for (let start = 0; start <= normContent.length - normOld.length; start++) {
    let match = true
    for (let j = 0; j < normOld.length; j++) {
      if (normContent[start + j] !== normOld[j]) {
        match = false
        break
      }
    }
    if (match) {
      // Compute byte position in ORIGINAL (unnormalized) content
      let charPos = 0
      for (let k = 0; k < start; k++) {
        charPos += contentLines[k]!.length + 1 // +1 for the \n
      }
      // Compute matched text length in ORIGINAL content
      let matchedLen = 0
      for (let j = 0; j < oldLines.length; j++) {
        matchedLen += contentLines[start + j]!.length
        if (j < oldLines.length - 1) matchedLen += 1 // +1 for the \n
      }
      matches.push({ index: charPos, length: matchedLen })
    }
  }

  return matches
}

interface SingleEdit {
  file_path: string
  old_string: string
  new_string: string
}

type Edit = SingleEdit

/** Parse markdown code block format into edits array */
function parseMarkdownEdit(content: string): Edit[] {
  const edits: Edit[] = []

  // Extract content from ```edit ... ``` code blocks
  const blockRegex = /```edit\s*([\s\S]*?)```/gi

  for (const regexMatch of content.matchAll(blockRegex)) {
    const blockContent = regexMatch[1]!

    // Parse file path
    const fileMatch = blockContent.match(/^file:\s*(.+)$/m)
    if (!fileMatch) continue
    const filePath = fileMatch[1]!.trim()

    // Parse old string (support both "old:" and "old: |" formats)
    let oldString = ''
    let newString = ''

    const oldMatch = blockContent.match(/^old:(?:\s*\|\s*\n)?([\s\S]*?)^new:/m)
    const newMatch = blockContent.match(/^new:(?:\s*\|\s*\n)?([\s\S]*?)$/m)

    if (oldMatch) {
      oldString = oldMatch[1]!.replace(/^\n/, '').replace(/\n$/, '')
    }
    if (newMatch) {
      newString = newMatch[1]!.replace(/^\n/, '').replace(/\n$/, '')
    }

    if (filePath) {
      edits.push({
        file_path: filePath,
        old_string: oldString || '',
        new_string: newString || '',
      })
    }
  }

  return edits
}

/** Extract edits from legacy JSON format (backward compatibility) */
function extractEditsFromJSON(input: Record<string, unknown>): Edit[] {
  // Pattern 0: input is an array (edits passed directly instead of wrapped)
  if (Array.isArray(input)) {
    // Preserve array for validation
    return input as Edit[]
  }

  // Pattern 1: input has file_path, old_string, new_string at top level (missing edits array)
  if (!Array.isArray(input.edits)) {
    const keys = Object.keys(input)

    // Check if the keys look like a single edit object (file_path + old_string + new_string)
    const hasFilePath = typeof input.file_path === 'string'
    const hasOldString = typeof input.old_string === 'string'
    const hasNewString = typeof input.new_string === 'string'

    if (hasFilePath && hasOldString && hasNewString) {
      return [
        {
          file_path: input.file_path as string,
          old_string: input.old_string as string,
          new_string: input.new_string as string,
        },
      ]
    } else if (hasFilePath && hasOldString) {
      // Only file_path + old_string (missing new_string)
      return [
        {
          file_path: input.file_path as string,
          old_string: input.old_string as string,
          new_string: (input.new_string as string) || '',
        },
      ]
    } else if (keys.length === 2 && hasFilePath && typeof input.new_string === 'string') {
      // file_path + new_string but no old_string — treat as new file creation
      return [
        {
          file_path: input.file_path as string,
          old_string: '',
          new_string: input.new_string as string,
        },
      ]
    } else if (keys.length === 1 && hasFilePath) {
      // Only file_path — maybe they meant create file with empty content?
      return [{ file_path: input.file_path as string, old_string: '', new_string: '' }]
    }
    return []
  }

  // If edits is an array (even empty), preserve for validation
  if (Array.isArray(input.edits)) {
    return input.edits as Edit[]
  }

  return []
}

export function createEditTool(applier: FileReadTracker, cwd: string): Tool {
  return {
    definition: {
      name: 'edit',
      description: `Replace exact text in files using markdown code block format.

HOW TO USE:
1. Read the file first with \`read\`
2. Copy the EXACT text to replace — include 2-3 lines of context before/after
3. Use markdown code block format below

FORMAT:
\`\`\`edit
file: <file_path>
old: |
  <exact text to find>
new: |
  <replacement text>
\`\`\`

EXAMPLES:
Single edit:
\`\`\`edit
file: src/config.ts
old: |
  mode: 'code'
new: |
  mode: 'plan'
\`\`\`

Create new file:
\`\`\`edit
file: src/new.ts
old:
new: |
  const x = 1
\`\`\`

CRITICAL RULES:
- old and new are separated by "old:" and "new:" labels
- Use | after label for multi-line content
- old_string must match EXACTLY (whitespace, indentation, line breaks)
- Do NOT include the "<lineNumber>: " prefix from read output`,
      parameters: {
        content: {
          type: 'string',
          description: 'Markdown code block with edit instructions. See description for format.',
          required: true,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      // ── Parse markdown format ─────────────────────────────────────────
      let edits: Edit[] = []

      // If input has 'content' field (new markdown format)
      if (typeof input.content === 'string') {
        edits = parseMarkdownEdit(input.content)
        if (edits.length === 0) {
          return {
            success: false,
            output: '',
            error:
              'Failed to parse edit format. Use: ```edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n```',
          }
        }
      } else {
        // Legacy JSON format (backward compatibility)
        edits = extractEditsFromJSON(input as Record<string, unknown>)
      }

      if (edits.length === 0) {
        // Check if input specifically had empty edits array (for better error message)
        const inputEdits = (input as Record<string, unknown>).edits
        if ('edits' in input && Array.isArray(inputEdits) && inputEdits.length === 0) {
          return {
            success: false,
            output: '',
            error: `edit FAILED — no edits to apply. The edits array exists but is empty.`,
          }
        }
        // Check if input has edits key but it's not an array
        if ('edits' in input && !Array.isArray((input as Record<string, unknown>).edits)) {
          return {
            success: false,
            output: '',
            error:
              'edit requires "edits" array. Use markdown format: ```edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n```',
          }
        }
        return {
          success: false,
          output: '',
          error:
            'No valid edits found (empty or invalid format). The edit array must contain objects with file_path, old_string, and new_string. Use markdown code block format: ```edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n```',
        }
      }

      // Debug: keep rawInput for error messages
      const rawInput = input

      // Validate each edit object
      const editErrors: string[] = []
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i]
        const missing: string[] = []
        if (typeof e.file_path !== 'string' || !e.file_path) missing.push('file_path')
        if (typeof e.old_string !== 'string') missing.push('old_string')
        if (typeof e.new_string !== 'string') missing.push('new_string')
        if (missing.length > 0) {
          const present = Object.keys(e)
            .filter(k => typeof e[k as keyof Edit] === 'string')
            .join(', ')
          editErrors.push(
            `  edit #${i + 1}: missing ${missing.join(', ')}${present ? ` (has: ${present})` : ''}`,
          )
        }
      }
      if (editErrors.length > 0) {
        return {
          success: false,
          output: '',
          error: `edit FAILED — ${editErrors.length} of ${edits.length} edit(s) have missing fields.\n${editErrors.join('\n')}\n\nReceived: ${JSON.stringify(rawInput)}\n\nEach edit object must be a COMPLETE find-replace pair with BOTH old_string AND new_string.`,
        }
      }

      const fileGroups = new Map<string, { edits: SingleEdit[]; originalContent: string | null }>()
      for (const e of edits) {
        const resolved = path.resolve(cwd, e.file_path)
        if (!fileGroups.has(resolved)) {
          let originalContent: string | null = null
          try {
            originalContent = fs.readFileSync(resolved, 'utf-8')
          } catch {
            /* file doesn't exist yet */
          }
          fileGroups.set(resolved, { edits: [], originalContent })
        }
        fileGroups.get(resolved)!.edits.push(e)
      }

      const results: string[] = []
      let anyFailed = false
      let firstError = ''
      const modifiedFiles = new Map<string, string | null>()

      for (const [resolved, group] of fileGroups) {
        const relPath = path.relative(cwd, resolved).replace(/\\/g, '/')
        let content =
          group.originalContent !== null ? group.originalContent.replace(/\r\n/g, '\n') : null

        // Check if file was read (for stale-content diagnostics)
        const readWarning = content !== null ? applier.checkModified(resolved) : null

        for (let i = group.edits.length - 1; i >= 0; i--) {
          const e = group.edits[i]
          // Normalize CRLF → LF in AI-provided strings (critical on Windows)
          e.old_string = e.old_string.replace(/\r\n/g, '\n')
          e.new_string = e.new_string.replace(/\r\n/g, '\n')

          if (e.old_string === '') {
            if (content !== null) {
              const diag = buildDiag({ ...e, old_string: '' })
              const suggestion = `  → Use edit with old_string to replace existing content, or choose a different path.`
              results.push(`  FAIL ${relPath}: File already exists — Raw input: ${JSON.stringify(rawInput)}
  Edit: ${diag}
${suggestion}`)
              if (!anyFailed) {
                anyFailed = true
                firstError = `File already exists: ${relPath}`
              }
              break
            }
            const newLines = e.new_string.split('\n').length
            content = e.new_string
            results.push(
              `  Created ${relPath} (${newLines} lines):\n${generateDiff('', e.new_string)}`,
            )
            continue
          }

          if (content === null) {
            const diag = buildDiag(e)
            const suggestion = `  → Check the file path, or create it first with old_string: "" (empty string).`
            results.push(`  FAIL ${relPath}: File not found — Raw input: ${JSON.stringify(rawInput)}
  Edit: ${diag}
${suggestion}`)
            if (!anyFailed) {
              anyFailed = true
              firstError = `File not found: ${relPath}`
            }
            break
          }

          // ── Tier 1: Exact match ──────────────────────────────────────
          const exactIdx = content.indexOf(e.old_string)

          let matchInfo: { index: number; length: number; strategy: 'exact' | 'tolerant' } | null =
            null

          if (exactIdx !== -1) {
            // Exact match found — check for duplicates
            const lastIdx = content.lastIndexOf(e.old_string)
            if (exactIdx !== lastIdx) {
              const diag = buildDiag(e)
              const suggestion = `  → Include more surrounding context lines (2-3 lines before and after) in old_string to make the match unique.`
              results.push(`  FAIL ${relPath}: old_string appears MULTIPLE times — Raw input: ${JSON.stringify(rawInput)}
  Edit: ${diag}
${suggestion}`)
              if (!anyFailed) {
                anyFailed = true
                firstError = `old_string appears MULTIPLE times in ${relPath}`
              }
              break
            }
            matchInfo = { index: exactIdx, length: e.old_string.length, strategy: 'exact' }
          } else {
            // ── Tier 2: Whitespace-normalized fallback ─────────────────
            const tolerant = findAllLinesTolerant(content, e.old_string)
            if (tolerant.length === 0) {
              // Not found by any strategy — include proximity hint
              const contentLines = content.split('\n')
              let hint = ''
              const firstLine = (e.old_string.split('\n')[0] || '').trim()
              if (firstLine) {
                const normFirst = normalizeLine(firstLine)
                // Try to find a line that contains the first line text
                const similarIdx = contentLines.findIndex(
                  l => l.length > 0 && normFirst.length > 0 && normalizeLine(l).includes(normFirst),
                )
                if (similarIdx !== -1) {
                  const start = Math.max(0, similarIdx - 1)
                  const end = Math.min(contentLines.length, similarIdx + 2)
                  const snippet = contentLines.slice(start, end).join('\n')
                  hint = `\n  Near line ${similarIdx + 1}:\n  """\n${snippet}\n  """`
                }
              }
              // Always show top of file for context, unless already shown via match
              if (!hint && contentLines.length > 0) {
                const lines = contentLines.slice(0, Math.min(contentLines.length, 5))
                hint = `\n  File content (first ${lines.length} lines):\n  """\n${lines.join('\n')}\n  """`
              }
              const diag = buildDiag(e)
              const readHint = readWarning ? `\n  ${readWarning}` : ''
              const suggestion = `  → Read the file again with read({ paths: ["${e.file_path}"] }) to get current content, then retry with exact matching text. Include 2-3 lines of surrounding context for uniqueness.${readHint}`
              results.push(`  FAIL ${relPath}: old_string not found — Raw input: ${JSON.stringify(rawInput)}
  Edit: ${diag}${hint}
${suggestion}`)
              if (!anyFailed) {
                anyFailed = true
                firstError = `old_string not found in ${relPath}${hint}`
              }
              break
            }
            if (tolerant.length > 1) {
              const diag = buildDiag(e)
              const suggestion = `  → Include more surrounding context lines (2-3 lines before and after) in old_string to make the match unique.`
              results.push(
                `  FAIL ${relPath}: old_string appears MULTIPLE times (whitespace-normalized) — Raw input: ${JSON.stringify(rawInput)}\n  Edit: ${diag}\n${suggestion}`,
              )
              if (!anyFailed) {
                anyFailed = true
                firstError = `old_string appears MULTIPLE times in ${relPath} (whitespace-normalized)`
              }
              break
            }
            matchInfo = {
              index: tolerant[0]!.index,
              length: tolerant[0]!.length,
              strategy: 'tolerant',
            }
          }

          const strategyLabel = matchInfo.strategy === 'tolerant' ? ' (whitespace-normalized)' : ''
          const matchLineNum = content.substring(0, matchInfo.index).split('\n').length
          const diff = generateDiff(e.old_string, e.new_string, matchLineNum - 1)
          results.push(`  Edited ${relPath}${strategyLabel}:\n${diff}`)
          content =
            content.slice(0, matchInfo.index) +
            e.new_string +
            content.slice(matchInfo.index + matchInfo.length)
        }

        if (anyFailed) break
        modifiedFiles.set(resolved, content)
      }

      if (anyFailed) {
        for (const [filePath, group] of fileGroups) {
          const originalContent = group.originalContent
          if (originalContent === null) {
            try {
              fs.unlinkSync(filePath)
            } catch {
              /* ok */
            }
          } else {
            try {
              fs.mkdirSync(path.dirname(filePath), { recursive: true })
              fs.writeFileSync(filePath, originalContent, 'utf-8')
            } catch {
              /* ok */
            }
          }
          applier.markRead(filePath)
        }
        // Only show FAIL lines in the error (successful edits were rolled back)
        const failLines = results.filter(r => r.startsWith('  FAIL ')).join('\n')
        return {
          success: false,
          output: '',
          error: `Edit FAILED — all changes rolled back. Raw input: ${JSON.stringify(rawInput)}\n${failLines}\n\n${firstError}`,
        }
      }

      for (const [resolved, content] of modifiedFiles) {
        try {
          if (content === null) {
            fs.unlinkSync(resolved)
          } else {
            fs.mkdirSync(path.dirname(resolved), { recursive: true })
            fs.writeFileSync(resolved, content, 'utf-8')
          }
        } catch (err) {
          return {
            success: false,
            output: '',
            error: `Failed to write ${path.relative(cwd, resolved).replace(/\\/g, '/')}: ${fmtErr(err)}. Input: ${JSON.stringify(rawInput)}`,
          }
        }
        applier.markRead(resolved)
      }

      return {
        success: true,
        output: results.join('\n').replace(/^ {2}/gm, ''),
      }
    },
  }
}
