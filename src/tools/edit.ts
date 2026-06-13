import * as fs from 'node:fs'
import * as path from 'node:path'
import { DIFF_DELETE, DIFF_INSERT, diffLinesRaw } from 'jest-diff'
import type { FileReadTracker } from '../diff/apply.js'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

// ── Diff types ────────────────────────────────────────────────────────────
export type DiffLineType = 'delete' | 'insert' | 'equal'

export interface DiffLine {
  type: DiffLineType
  content: string
}

// ── ANSI colors for terminal output ───────────────────────────────────────
const DIFF_RED = '\x1b[38;2;255;80;80m'
const DIFF_GREEN = '\x1b[38;2;0;200;100m'
const DIFF_DIM = '\x1b[38;2;100;100;100m'
const DIFF_RESET = '\x1b[0m'

// ── Colors for HTML output ────────────────────────────────────────────────
const HTML_RED = '#ff5050'
const HTML_GREEN = '#00c864'
const HTML_DIM = '#888888'

/** Build diagnostic JSON for error messages */
function buildDiag(edit: SingleEdit): string {
  return JSON.stringify({
    file_path: edit.file_path,
    old_string: edit.old_string,
    new_string: edit.new_string,
  })
}

/** Summarize raw input for error messages to avoid dumping huge strings into the LLM context. */
function summarizeRawInput(rawInput: unknown): string {
  const s = JSON.stringify(rawInput)
  if (s.length <= 500) return s
  return `${s.slice(0, 500)}... [truncated, total ${s.length} chars]`
}

/** Compute diff lines using jest-diff for proper line-level diffs */
export function computeDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr === '' ? [] : oldStr.split('\n')
  const newLines = newStr === '' ? [] : newStr.split('\n')

  if (oldLines.length === 0 && newLines.length === 0) return []

  const rawDiff = diffLinesRaw(oldLines, newLines)
  return rawDiff.map(d => ({
    type:
      d[0] === DIFF_DELETE
        ? ('delete' as const)
        : d[0] === DIFF_INSERT
          ? ('insert' as const)
          : ('equal' as const),
    content: d[1],
  }))
}

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
/** Export for testing */
export function normalizeLine(s: string): string {
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
/** Export for testing */
export function findAllLinesTolerant(content: string, oldString: string): MatchPos[] {
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

/** Export for testing */
export function parseMarkdownEdit(content: string): Edit[] {
  const edits: Edit[] = []

  function parseEditBlock(raw: string): Edit | null {
    // Remove stray ``` lines (model may close the block early before new:)
    const cleaned = raw.replace(/^```\s*$/gm, '')

    const fileMatch = cleaned.match(/^file:\s*(.+)$/m)
    if (!fileMatch) return null
    const filePath = fileMatch[1]!.trim()

    let oldString = ''
    let newString = ''

    const oldMatch = cleaned.match(/^old:(?:\s*\|\d*\s*\n)?([\s\S]*?)^new:/m)
    const newMatch = cleaned.match(/^new:(?:\s*\|\d*\s*\n)?([\s\S]*)$/m)

    if (oldMatch) {
      oldString = oldMatch[1]!.replace(/^\n+/, '').replace(/\n+$/, '')
    }
    if (newMatch) {
      newString = newMatch[1]!.replace(/^\n+/, '').replace(/\n+$/, '')
    }

    return { file_path: filePath, old_string: oldString || '', new_string: newString || '' }
  }

  // Strategy 1: Non-greedy block regex (handles multi-edit, correct formatting)
  const blockRegex = /```edit\s*([\s\S]*?)```/gi
  for (const regexMatch of content.matchAll(blockRegex)) {
    const edit = parseEditBlock(regexMatch[1]!)
    if (edit) edits.push(edit)
  }

  // Strategy 2: If no edit with new_string found (model likely closed ``` before new:),
  // retry with greedy matching to capture everything up to the last ```
  if (!edits.some(e => e.new_string)) {
    edits.length = 0
    const greedyRegex = /```edit\s*([\s\S]*)```/g
    for (const regexMatch of content.matchAll(greedyRegex)) {
      const edit = parseEditBlock(regexMatch[1]!)
      if (edit) edits.push(edit)
    }
  }

  // Strategy 3: No block markers at all — try parsing raw content directly
  if (edits.length === 0) {
    const edit = parseEditBlock(content)
    if (edit) edits.push(edit)
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
      // Only file_path + old_string (missing new_string) — use a sentinel
      // value so validation catches this as an error instead of silently deleting content.
      return [
        {
          file_path: input.file_path as string,
          old_string: input.old_string as string,
          new_string: (input.new_string as string) || '__MISSING_NEW_STRING__',
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
      category: 'Edit',
      group: 'File',
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
old: |
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
      // Debug: keep rawInput for error messages (capture early for all error paths)
      const rawInput = input

      // ── Parse markdown format ─────────────────────────────────────────
      let edits: Edit[] = []

      // If input has 'content' field (new markdown format)
      if (typeof input.content === 'string') {
        // Compat: handle double-JSON-wrapped content
        let contentStr = input.content
        try {
          const parsed = JSON.parse(contentStr)
          if (typeof parsed === 'string') {
            contentStr = parsed
          } else if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
            contentStr = parsed.content
          }
        } catch {
          // Not JSON — use as-is
        }
        edits = parseMarkdownEdit(contentStr)
        if (edits.length === 0) {
          return {
            success: false,
            output: '',
            error: `Failed to parse edit format. Raw input: ${summarizeRawInput(rawInput)}\nUse: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\``,
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
            error: `edit FAILED — no edits to apply. The edits array exists but is empty. Raw input: ${summarizeRawInput(rawInput)}`,
          }
        }
        // Check if input has edits key but it's not an array
        if ('edits' in input && !Array.isArray((input as Record<string, unknown>).edits)) {
          return {
            success: false,
            output: '',
            error: `edit requires "edits" array. Use markdown format: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\`\nRaw input: ${summarizeRawInput(rawInput)}`,
          }
        }
        return {
          success: false,
          output: '',
          error: `No valid edits found (empty or invalid format). The edit array must contain objects with file_path, old_string, and new_string. Use markdown code block format: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\`\nRaw input: ${summarizeRawInput(rawInput)}`,
        }
      }

      // Validate each edit object
      const editErrors: string[] = []
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i]
        const missing: string[] = []
        if (typeof e.file_path !== 'string' || !e.file_path) missing.push('file_path')
        if (typeof e.old_string !== 'string') missing.push('old_string')
        if (typeof e.new_string !== 'string') missing.push('new_string')
        if (e.new_string === '__MISSING_NEW_STRING__') {
          missing.push('new_string (required — LLM must provide a non-empty replacement)')
        }
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
          error: `edit FAILED — ${editErrors.length} of ${edits.length} edit(s) have missing fields.\n${editErrors.join('\n')}\n\nReceived: ${summarizeRawInput(rawInput)}\n\nEach edit object must be a COMPLETE find-replace pair with BOTH old_string AND new_string.`,
        }
      }

      // ── Path traversal security check ──────────────────────────────────
      const resolvedCwd = path.resolve(cwd)
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i]
        const resolved = path.resolve(cwd, e.file_path)
        const relative = path.relative(resolvedCwd, resolved)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          return {
            success: false,
            output: '',
            error:
              'edit FAILED — Path traversal detected: "' +
              e.file_path +
              '" resolves outside the working directory "' +
              resolvedCwd +
              '". All file paths must be within the project directory.',
          }
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
              // File already exists in-memory (from prior edit in this batch)
              // or on disk — treat as error to prevent silent overwrites.
              results.push(
                `  FAIL ${relPath}: Cannot create — file already exists (duplicate create in batch or file on disk)`,
              )
              if (!anyFailed) {
                anyFailed = true
                firstError = `Cannot create file "${relPath}": file already exists`
              }
              break
            }
            const newLines = e.new_string.split('\n').length
            content = e.new_string
            results.push(
              `  Created ${relPath} (${newLines} lines):\n${generateDiff('', e.new_string, 1)}`,
            )
            continue
          }

          if (content === null) {
            const diag = buildDiag(e)
            const suggestion = `  → Check the file path, or create it first with old_string: "" (empty string).`
            results.push(`  FAIL ${relPath}: File not found
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
              results.push(`  FAIL ${relPath}: old_string appears MULTIPLE times
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
              results.push(`  FAIL ${relPath}: old_string not found${hint}
  Edit: ${diag}
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
                `  FAIL ${relPath}: old_string appears MULTIPLE times (whitespace-normalized)\n  Edit: ${diag}\n${suggestion}`,
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

          // For tolerant matching, use the actual file text at the match position
          // so the diff reflects what was really in the file (with original whitespace).
          const matchedOld =
            matchInfo.strategy === 'tolerant'
              ? content.slice(matchInfo.index, matchInfo.index + matchInfo.length)
              : e.old_string
          const diff = generateDiffWithContext(
            content,
            matchedOld,
            e.new_string,
            matchInfo.index,
            matchInfo.length,
          )
          results.push(`  Edited ${relPath}:\n${diff}`)
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
          error: `Edit FAILED — all changes rolled back.\n${failLines}\n\n${firstError}`,
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
            error: `Failed to write ${path.relative(cwd, resolved).replace(/\\/g, '/')}: ${fmtErr(err)}. Input: ${summarizeRawInput(rawInput)}`,
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
