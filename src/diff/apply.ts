import * as fs from 'node:fs'
import * as path from 'node:path'
import { Patch, FileChange, Hunk, HunkLine } from './types.js'

export interface ApplyResult {
  success: boolean
  results: Array<{
    path: string
    operation: string
    status: 'applied' | 'skipped' | 'error' | 'rolled back'
    error?: string
  }>
}

export interface FileState {
  lastReadTime: number
  modTime: number
}

export class PatchApplier {
  private readFiles: Map<string, FileState> = new Map()

  markRead(filePath: string): void {
    const resolved = path.resolve(filePath)
    try {
      const stat = fs.statSync(resolved)
      this.readFiles.set(resolved, {
        lastReadTime: Date.now(),
        modTime: stat.mtimeMs,
      })
    } catch {
      this.readFiles.set(resolved, {
        lastReadTime: Date.now(),
        modTime: 0,
      })
    }
  }

  private checkModified(resolvedPath: string): string | null {
    const state = this.readFiles.get(resolvedPath)
    if (!state) {
      return `File "${resolvedPath}" was not read in this session. Read it first before editing.`
    }
    try {
      const stat = fs.statSync(resolvedPath)
      if (stat.mtimeMs > state.modTime) {
        return `File "${resolvedPath}" was modified externally since last read. Re-read it before editing.`
      }
    } catch {
      return `File "${resolvedPath}" no longer exists.`
    }
    return null
  }

  apply(patch: Patch, cwd: string): ApplyResult {
    const results: ApplyResult['results'] = []

    const snapshots: Map<string, string | null> = new Map()
    const rollback: Map<string, string | null> = new Map()
    let failedChange: FileChange | null = null
    let failureError = ''

    try {
      for (const change of patch.changes) {
        const resolvedPath = path.resolve(cwd, change.path)

        if (change.operation === 'delete') {
          const err = this.checkModified(resolvedPath)
          if (err) {
            failedChange = change
            failureError = err
            throw new Error(err)
          }
          snapshots.set(resolvedPath, fs.readFileSync(resolvedPath, 'utf-8'))
          rollback.set(resolvedPath, null)
        } else if (change.operation === 'update') {
          const err = this.checkModified(resolvedPath)
          if (err) {
            failedChange = change
            failureError = err
            throw new Error(err)
          }
          const content = fs.readFileSync(resolvedPath, 'utf-8')
          snapshots.set(resolvedPath, content)
          const applyResult = applyHunks(content, change.hunks)
          if (typeof applyResult !== 'string') {
            failedChange = change
            failureError = `Failed to apply hunks to "${change.path}" - ${applyResult.reason}`
            throw new Error(failureError)
          }
          rollback.set(resolvedPath, applyResult)
        } else if (change.operation === 'create') {
          if (fs.existsSync(resolvedPath)) {
            failedChange = change
            failureError = `File "${change.path}" already exists. Cannot create.`
            throw new Error(failureError)
          }
          rollback.set(resolvedPath, change.content || '')
        }
      }

      for (const [filePath, content] of rollback) {
        if (content === null) {
          fs.unlinkSync(filePath)
          results.push({
            path: filePath,
            operation: 'delete',
            status: 'applied',
          })
        } else {
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          fs.writeFileSync(filePath, content, 'utf-8')
          const change = patch.changes.find(c => path.resolve(cwd, c.path) === filePath)
          results.push({
            path: filePath,
            operation: change?.operation || 'update',
            status: 'applied',
          })
        }
      }

      return { success: true, results }
    } catch (err) {
      for (const [filePath, content] of snapshots) {
        if (content === null) {
          try { fs.unlinkSync(filePath) } catch { }
        } else {
          try { fs.writeFileSync(filePath, content, 'utf-8') } catch { }
        }
      }

      for (const change of patch.changes) {
        const isFailed = failedChange && path.resolve(cwd, change.path) === path.resolve(cwd, failedChange.path)
        results.push({
          path: change.path,
          operation: change.operation,
          status: isFailed ? 'error' : 'rolled back',
          error: isFailed ? failureError : undefined,
        })
      }
      return { success: false, results }
    }
  }
}

function applyHunks(content: string, hunks: Hunk[]): string | { reason: string } {
  let lines = content.split('\n')

  for (let i = hunks.length - 1; i >= 0; i--) {
    const result = applyHunk(lines, hunks[i])
    if (Array.isArray(result)) {
      lines = result
      continue
    }
    return result
  }

  return lines.join('\n')
}

function applyHunk(lines: string[], hunk: Hunk): string[] | { reason: string } {
  const match = findHunkStart(lines, hunk)
  if (typeof match === 'object') return match

  const at = match
  let cursor = at
  for (let i = 0; i < hunk.lines.length; i++) {
    const hl = hunk.lines[i]
    if (hl.kind === 'add') continue
    const fileLine = lines[cursor] ?? '<EOF>'
    if (normalize(fileLine) !== normalize(hl.text)) {
      // Give a precise diagnostic for the first mismatch.
      return {
        reason: `hunk @@ -${hunk.oldStart},${hunk.oldCount} @@ does not match at line ${cursor + 1}:\n`
          + `  expected (${hl.kind}): ${JSON.stringify(hl.text)}\n`
          + `  actual          : ${JSON.stringify(fileLine)}\n\n`
          + `Fix: re-run \`read\` and resend the hunk with the correct line numbers (the \`read\` output prefixes each line with "<lineNumber>: ").`,
      }
    }
    cursor++
  }

  // Build new-window lines: context + add (skip delete).
  const newWindow: string[] = []
  for (const hl of hunk.lines) {
    if (hl.kind === 'delete') continue
    newWindow.push(hl.text)
  }

  const oldWindowLen = cursor - at
  const result = [...lines]
  result.splice(at, oldWindowLen, ...newWindow)
  return result
}

/** Try to place the hunk at oldStart-1; if the first context/delete line
 *  doesn't match there, search backward by up to 5 lines — models often
 *  include leading context before the actual change line. */
function findHunkStart(lines: string[], hunk: Hunk): number | { reason: string } {
  const firstContent = hunk.lines.find(l => l.kind !== 'add')
  if (!firstContent) return hunk.oldStart - 1

  const fileLen = lines.length
  let startPos = Math.max(0, hunk.oldStart - 1 - 5)

  for (let pos = startPos; pos <= Math.min(fileLen, hunk.oldStart - 1); pos++) {
    const fileLine = lines[pos] ?? ''
    if (normalize(fileLine) === normalize(firstContent.text)) {
      return pos
    }
  }

  // If the expected position is past the file end, bail out early.
  if (hunk.oldStart - 1 >= fileLen) {
    return {
      reason: `hunk @@ -${hunk.oldStart},${hunk.oldCount} @@ starts at line ${hunk.oldStart}, but the file only has ${fileLen} lines.\n\nFix: re-run \`read\` and use a valid oldStart that matches the current file.`,
    }
  }

  // Show what's at oldStart-1 vs the first hunk line.
  const actual = lines[hunk.oldStart - 1] ?? '<EOF>'
  return {
    reason: `hunk @@ -${hunk.oldStart},${hunk.oldCount} @@ does not match at line ${hunk.oldStart}:\n`
      + `  expected first line: ${JSON.stringify(firstContent.text)}\n`
      + `  actual             : ${JSON.stringify(actual)}\n\n`
      + `Fix: re-run \`read\` and resend the hunk with the correct line numbers.`,
  }
}
function normalize(s: string): string {
  return s.replace(/\r/g, '').replace(/\t/g, '  ').replace(/[ \t]+/g, ' ').trimEnd()
}