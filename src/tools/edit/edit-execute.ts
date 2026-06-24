import * as fs from 'node:fs'
import * as path from 'node:path'
import type { FileReadTracker } from '../../diff/apply.js'
import { fmtErr } from '../errors.js'
import type { ToolResult } from '../types.js'
import { generateDiff, generateDiffWithContext } from './diff-render.js'
import { fixFileIndentation } from './indent-fix.js'
import {
  findAllLinesFuzzy,
  findAllLinesSmart,
  findAllLinesTolerant,
  normalizeLine,
} from './matcher.js'
import { buildDiag, extractEditsFromJSON, parseMarkdownEdit, summarizeRawInput } from './parser.js'
import type { Edit, SingleEdit } from './types.js'

/** Shorthand for an error result. */
function fail(msg: string): ToolResult {
  return { success: false, output: '', error: msg }
}

export async function executeEditTool(
  applier: FileReadTracker,
  cwd: string,
  input: any,
): Promise<ToolResult> {
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
      return fail(
        `Failed to parse edit format. Raw input: ${summarizeRawInput(rawInput)}\nUse: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\``,
      )
    }
  } else {
    // Legacy JSON format (backward compatibility)
    edits = extractEditsFromJSON(input as Record<string, unknown>)
  }

  if (edits.length === 0) {
    // Check if input specifically had empty edits array (for better error message)
    const inputEdits = (input as Record<string, unknown>).edits
    if ('edits' in input && Array.isArray(inputEdits) && inputEdits.length === 0) {
      return fail(
        `edit FAILED — no edits to apply. The edits array exists but is empty. Raw input: ${summarizeRawInput(rawInput)}`,
      )
    }
    // Check if input has edits key but it's not an array
    if ('edits' in input && !Array.isArray((input as Record<string, unknown>).edits)) {
      return fail(
        `edit requires "edits" array. Use markdown format: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\`\nRaw input: ${summarizeRawInput(rawInput)}`,
      )
    }
    return fail(
      `No valid edits found (empty or invalid format). The edit array must contain objects with file_path, old_string, and new_string. Use markdown code block format: \`\`\`edit\\nfile: path\\nold: |\\ntext\\nnew: |\\ntext\\n\`\`\`\nRaw input: ${summarizeRawInput(rawInput)}`,
    )
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
    return fail(
      `edit FAILED — ${editErrors.length} of ${edits.length} edit(s) have missing fields.\n${editErrors.join('\n')}\n\nReceived: ${summarizeRawInput(rawInput)}\n\nEach edit object must be a COMPLETE find-replace pair with BOTH old_string AND new_string.`,
    )
  }

  // ── Path traversal security check (symlink-aware) ─────────────────
  const resolvedCwd = path.resolve(cwd)
  let realCwd: string
  try {
    realCwd = fs.realpathSync(resolvedCwd)
  } catch {
    realCwd = resolvedCwd
  }
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i]
    const resolved = path.resolve(cwd, e.file_path)
    const relative = path.relative(resolvedCwd, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return fail(
        `edit FAILED — Path traversal detected: "${e.file_path}" resolves outside the working directory "${resolvedCwd}". All file paths must be within the project directory.`,
      )
    }
    // Symlink-aware check: resolve real path to detect traversal via symlink
    let realPath: string
    try {
      realPath = fs.realpathSync(resolved)
    } catch {
      // File doesn't exist yet – resolve nearest existing ancestor through symlinks
      let dir = path.dirname(resolved)
      while (!fs.existsSync(dir)) {
        const parent = path.dirname(dir)
        if (parent === dir) break // root
        dir = parent
      }
      try {
        realPath = path.join(fs.realpathSync(dir), path.relative(dir, resolved))
      } catch {
        realPath = resolved
      }
    }
    const realRelative = path.relative(realCwd, realPath)
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      return fail(
        `edit FAILED — Path traversal detected via symlink: "${e.file_path}" resolves outside "${realCwd}".`,
      )
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

      let matchInfo: {
        index: number
        length: number
        strategy: 'exact' | 'tolerant' | 'smart'
      } | null = null

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
        if (tolerant.length === 1) {
          matchInfo = {
            index: tolerant[0]!.index,
            length: tolerant[0]!.length,
            strategy: 'tolerant',
          }
        } else if (tolerant.length > 1) {
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
        } else {
          // ── Tier 3: Smart matching (aggressive normalization) ────
          const smart = findAllLinesSmart(content, e.old_string)
          if (smart.length === 1) {
            matchInfo = {
              index: smart[0]!.index,
              length: smart[0]!.length,
              strategy: 'smart',
            }
          } else if (smart.length > 1) {
            const diag = buildDiag(e)
            const suggestion = `  → Include more surrounding context lines (2-3 lines before and after) in old_string to make the match unique.`
            results.push(
              `  FAIL ${relPath}: old_string appears MULTIPLE times (smart-matched)\n  Edit: ${diag}\n${suggestion}`,
            )
            if (!anyFailed) {
              anyFailed = true
              firstError = `old_string appears MULTIPLE times in ${relPath} (smart-matched)`
            }
            break
          } else {
            // 4b. Try fuzzy LCS-based matching (tolerates up to 20% mismatched lines)
            const fuzzy = findAllLinesFuzzy(content, e.old_string)
            if (fuzzy.length > 0) {
              matchInfo = {
                index: fuzzy[0]!.index,
                length: fuzzy[0]!.length,
                strategy: 'smart',
              }
            } else {
              // Not found by any strategy — check if old_string lines are scattered (non-contiguous)
              const contentLines = content.split('\n')
              const oldLines = e.old_string.split('\n').filter(l => l.trim())
              const foundIndices: number[] = []
              for (const ol of oldLines) {
                const normOl = normalizeLine(ol.trim())
                if (!normOl) continue
                const idx = contentLines.findIndex(
                  (cl, ci) => !foundIndices.includes(ci) && normalizeLine(cl).includes(normOl),
                )
                if (idx !== -1) foundIndices.push(idx)
              }
              let hint = ''
              const isScattered =
                foundIndices.length >= 2 &&
                foundIndices[foundIndices.length - 1]! - foundIndices[0]! + 1 > foundIndices.length

              if (isScattered) {
                hint = `\n  ⚠️  ${foundIndices.length} lines of old_string were found in the file, but they are NOT contiguous — you skipped lines between them.
  old_string must be a CONTIGUOUS chunk of the file. Use separate \`\`\`edit blocks for each section (see "Multiple files" example above).
  Matched at lines: ${foundIndices.map(i => i + 1).join(', ')}`
              } else {
                const firstLine = (e.old_string.split('\n')[0] || '').trim()
                if (firstLine) {
                  const normFirst = normalizeLine(firstLine)
                  const similarIdx = contentLines.findIndex(
                    l =>
                      l.length > 0 && normFirst.length > 0 && normalizeLine(l).includes(normFirst),
                  )
                  if (similarIdx !== -1) {
                    const start = Math.max(0, similarIdx - 1)
                    const end = Math.min(contentLines.length, similarIdx + 2)
                    const snippet = contentLines.slice(start, end).join('\n')
                    hint = `\n  Near line ${similarIdx + 1}:\n  """\n${snippet}\n  """`
                  }
                }
                if (!hint && contentLines.length > 0) {
                  const lines = contentLines.slice(0, Math.min(contentLines.length, 5))
                  hint = `\n  File content (first ${lines.length} lines):\n  """\n${lines.join('\n')}\n  """`
                }
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
            } // close inner else (fuzzy failure)
          } // close outer else (smart === 0 / fuzzy success)
        }
      }

      // For tolerant/smart matching, use the actual file text at the match position
      // so the diff reflects what was really in the file (with original whitespace).
      let smartLabel = ''
      const matchedOld =
        matchInfo.strategy === 'exact'
          ? e.old_string
          : content.slice(matchInfo.index, matchInfo.index + matchInfo.length)
      if (matchInfo.strategy === 'smart') {
        smartLabel = ' [smart-matched]'
      }
      const diff = generateDiffWithContext(
        content,
        matchedOld,
        e.new_string,
        matchInfo.index,
        matchInfo.length,
      )
      results.push(`  Edited ${relPath}:${smartLabel}\n${diff}`)
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
    return fail(`Edit FAILED — all changes rolled back.\n${failLines}\n\n${firstError}`)
  }

  for (const [resolved, content] of modifiedFiles) {
    try {
      if (content === null) {
        fs.unlinkSync(resolved)
      } else {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, content, 'utf-8')
        // Best-effort indentation fix — silently ignore failures
        try {
          fixFileIndentation(resolved, cwd)
        } catch {
          /* indentation fixing is optional */
        }
      }
    } catch (err) {
      return fail(
        `Failed to write ${path.relative(cwd, resolved).replace(/\\/g, '/')}: ${fmtErr(err)}. Input: ${summarizeRawInput(rawInput)}`,
      )
    }
    applier.markRead(resolved)
  }

  return {
    success: true,
    output: results.join('\n').replace(/^ {2}/gm, ''),
  }
}
