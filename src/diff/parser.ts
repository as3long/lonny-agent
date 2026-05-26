import { Patch, FileChange, FileOperationType, Hunk, HunkLine } from './types.js'

// File header: "@ path" or "@ path:create" / "@ path:delete".
// Path may be a Windows absolute path (e.g. "C:\foo\bar"), so we anchor
// the optional ":create" / ":delete" suffix at end of line and let the
// path consume everything before it. Path must not start with "@" to
// avoid matching "@ @@ ...".
const FILE_HEADER_RE = /^@\s+(?!@)(.+?)(:create|:delete)?$/
const HUNK_HEADER_RE = /^@@\s+-(\d+),?(\d*)\s+\+(\d+),?(\d*)\s*@@/

interface ParseResult {
  patch: Patch
  errors: string[]
}

export function parsePatch(text: string): ParseResult {
  const changes: FileChange[] = []
  const errors: string[] = []

  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    const fileMatch = line.match(FILE_HEADER_RE)
    if (fileMatch) {
      const path = fileMatch[1].trim()
      const opMarker = fileMatch[2] // ":create" | ":delete" | undefined
      const operation: FileOperationType = opMarker === ':create'
        ? 'create'
        : opMarker === ':delete' ? 'delete' : 'update'

      const startLines: string[] = []
      i++
      const blockEnd = findBlockEnd(lines, i)
      const blockLines = lines.slice(i, blockEnd)

      if (operation === 'delete') {
        changes.push({ path, operation, hunks: [] })
        i = blockEnd
        continue
      }

      if (operation === 'create') {
        const contentLines: string[] = []
        for (const bl of blockLines) {
          if (bl.startsWith('+')) {
            contentLines.push(bl.slice(1))
          } else if (bl.startsWith(' ')) {
            contentLines.push(bl.slice(1))
          } else if (bl === '') {
            contentLines.push('')
          }
        }
        changes.push({
          path,
          operation,
          hunks: [],
          content: contentLines.join('\n'),
        })
        i = blockEnd
        continue
      }

      const hunks: Hunk[] = []
      let j = i
      while (j < blockEnd) {
        const hunkMatch = lines[j].match(HUNK_HEADER_RE)
        if (hunkMatch) {
          const oldStart = parseInt(hunkMatch[1], 10)
          const oldCount = hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1
          const newStart = parseInt(hunkMatch[3], 10)
          const newCount = hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1

          j++
          const hunkLines: HunkLine[] = []
          while (j < blockEnd && !HUNK_HEADER_RE.test(lines[j]) && !FILE_HEADER_RE.test(lines[j])) {
            const hl = lines[j]
            if (hl.startsWith('+')) {
              hunkLines.push({ kind: 'add', text: hl.slice(1) })
            } else if (hl.startsWith('-')) {
              hunkLines.push({ kind: 'delete', text: hl.slice(1) })
            } else if (hl.startsWith(' ')) {
              hunkLines.push({ kind: 'context', text: hl.slice(1) })
            }
            j++
          }

          hunks.push({
            oldStart,
            oldCount,
            newStart,
            newCount,
            lines: hunkLines,
          })
        } else {
          j++
        }
      }

      // Only push update changes that contain at least one hunk; otherwise
      // a stray "@ something" line would silently produce a no-op change.
      if (hunks.length > 0) {
        changes.push({ path, operation, hunks })
      }
      i = blockEnd
    } else {
      i++
    }
  }

  return { patch: { changes }, errors }
}

function findBlockEnd(lines: string[], start: number): number {
  for (let i = start; i < lines.length; i++) {
    if (FILE_HEADER_RE.test(lines[i])) {
      return i
    }
  }
  return lines.length
}