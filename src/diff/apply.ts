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

  private checkModified(filePath: string): string | null {
    const resolved = path.resolve(filePath)
    const state = this.readFiles.get(resolved)
    if (!state) {
      return `File "${filePath}" was not read in this session. Read it first before editing.`
    }
    try {
      const stat = fs.statSync(resolved)
      if (stat.mtimeMs > state.modTime) {
        return `File "${filePath}" was modified externally since last read. Re-read it before editing.`
      }
    } catch {
      return `File "${filePath}" no longer exists.`
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
          const err = this.checkModified(change.path)
          if (err) {
            failedChange = change
            failureError = err
            throw new Error(err)
          }
          snapshots.set(resolvedPath, fs.readFileSync(resolvedPath, 'utf-8'))
          rollback.set(resolvedPath, null)
        } else if (change.operation === 'update') {
          const err = this.checkModified(change.path)
          if (err) {
            failedChange = change
            failureError = err
            throw new Error(err)
          }
          const content = fs.readFileSync(resolvedPath, 'utf-8')
          snapshots.set(resolvedPath, content)
          const newContent = applyHunks(content, change.hunks)
          if (newContent === null) {
            failedChange = change
            failureError = `Failed to apply hunks to "${change.path}" - context lines did not match`
            throw new Error(failureError)
          }
          rollback.set(resolvedPath, newContent)
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

function applyHunks(content: string, hunks: Hunk[]): string | null {
  let lines = content.split('\n')

  for (let i = hunks.length - 1; i >= 0; i--) {
    const result = applyHunk(lines, hunks[i])
    if (result === null) {
      return null
    }
    lines = result
  }

  return lines.join('\n')
}

function applyHunk(lines: string[], hunk: Hunk): string[] | null {
  const ctxLines = hunk.lines.filter(l => l.kind === 'context').map(l => l.text)
  if (ctxLines.length === 0) {
    const delCount = hunk.lines.filter(l => l.kind === 'delete').length
    const addLines = hunk.lines.filter(l => l.kind === 'add').map(l => l.text)
    const newLines = [...lines]
    const startIdx = hunk.oldStart - 1
    newLines.splice(startIdx, delCount, ...addLines)
    return newLines
  }

  const matchIdx = findContext(lines, hunk)
  if (matchIdx === -1) {
    return null
  }

  const delCount = hunk.lines.filter(l => l.kind === 'delete').length
  const addLines = hunk.lines.filter(l => l.kind === 'add').map(l => l.text)
  const result = [...lines]
  result.splice(matchIdx, delCount, ...addLines)
  return result
}

function findContext(lines: string[], hunk: Hunk): number {
  const ctxLines = hunk.lines.filter(l => l.kind === 'context').map(l => l.text)
  if (ctxLines.length === 0) return hunk.oldStart - 1

  const maxScore = ctxLines.length * 3
  const searchRadius = 50
  const fileLen = lines.length

  const start = Math.max(0, hunk.oldStart - 1 - searchRadius)
  const end = Math.min(fileLen - ctxLines.length, hunk.oldStart - 1 + searchRadius)

  let bestIdx = -1
  let bestScore = 0

  for (let i = start; i <= end; i++) {
    const score = scoreContext(lines, i, ctxLines)
    if (score >= maxScore) {
      return i
    }
    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  if (bestIdx >= 0) return bestIdx

  for (let i = 0; i < start; i++) {
    const score = scoreContext(lines, i, ctxLines)
    if (score >= maxScore) return i
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }

  for (let i = end + 1; i <= fileLen - ctxLines.length; i++) {
    const score = scoreContext(lines, i, ctxLines)
    if (score >= maxScore) return i
    if (score > bestScore) { bestScore = score; bestIdx = i }
  }

  return bestIdx
}

function scoreContext(lines: string[], startIdx: number, ctxLines: string[]): number {
  let score = 0
  for (let i = 0; i < ctxLines.length; i++) {
    const fileLine = lines[startIdx + i] ?? ''
    const ctxLine = ctxLines[i]
    if (fileLine === ctxLine) {
      score += 3
    } else if (normalize(fileLine) === normalize(ctxLine)) {
      score += 2
    } else if (fuzzyMatch(fileLine, ctxLine)) {
      score += 1
    }
  }
  return score
}

function normalize(s: string): string {
  return s.replace(/\t/g, '  ').replace(/[ \t]+/g, ' ').trimEnd()
}

function fuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (a.trimEnd() === b.trimEnd()) return true
  if (a.trim() === b.trim()) return true
  if (normalize(a) === normalize(b)) return true
  return false
}