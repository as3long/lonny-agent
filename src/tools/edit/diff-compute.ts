import { DIFF_DELETE, DIFF_INSERT, diffLinesRaw } from 'jest-diff'
import type { DiffLine } from './types.js'

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
