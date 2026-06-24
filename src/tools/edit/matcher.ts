import type { MatchPos } from './types.js'

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

/**
 * Enhanced normalization for smart matching:
 * 1. Trim leading/trailing whitespace
 * 2. Replace ALL tabs with single spaces (tab normalization)
 * 3. Collapse ALL internal whitespace runs (including single tabs)
 * 4. Trim again after replacements
 *
 * This is more aggressive than normalizeLine:
 * - Tabs are normalized to spaces (so `a\tb` matches `a b`)
 * - Single-tab runs are collapsed (not just {2,})
 */
/** Export for testing */
export function normalizeLineSmart(s: string): string {
  return s
    .trim()
    .replace(/\t/g, ' ') // tabs → single space
    .replace(/[ \t]+/g, ' ') // collapse ALL whitespace runs
    .trim()
}

// ── Generic matcher factory ─────────────────────────────────────────────

type Normalizer = (s: string) => string

/**
 * Generic sliding-window line matching with configurable normalization.
 * Shared logic for findAllLinesTolerant and findAllLinesSmart.
 */
function findLinesWithNormalizer(
  content: string,
  oldString: string,
  normalizer: Normalizer,
): MatchPos[] {
  if (oldString === '') return []

  const contentLines = content.split('\n')
  const oldLines = oldString.split('\n')

  if (oldLines.length > contentLines.length) return []

  const normContent = contentLines.map(normalizer)
  const normOld = oldLines.map(normalizer)

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
      // Compute character position in ORIGINAL (unnormalized) content
      let charPos = 0
      for (let k = 0; k < start; k++) {
        charPos += contentLines[k]!.length + 1 // +1 for the \n
      }
      // Compute matched text length in ORIGINAL content
      let matchedLen = 0
      for (let j = 0; j < oldLines.length; j++) {
        const line = contentLines[start + j]!
        let lineLen = line.length
        // CRLF: the last line's trailing \r is part of content but not in oldString
        if (j === oldLines.length - 1 && line.endsWith('\r')) lineLen -= 1
        matchedLen += lineLen
        if (j < oldLines.length - 1) matchedLen += 1 // +1 for the \n
      }
      matches.push({ index: charPos, length: matchedLen })
    }
  }

  return matches
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
  return findLinesWithNormalizer(content, oldString, normalizeLine)
}

/**
 * Intelligent line matching with deeper tolerance than findAllLinesTolerant.
 *
 * Strategy 1 — Full line-by-line matching with smart normalization:
 *   - Tab normalization (tabs → spaces)
 *   - Collapse ALL whitespace runs (not just {2,})
 *   - This handles cases where the AI uses spaces but the file uses tabs,
 *     or vice versa.
 *
 * Strategy 2 — (Single-line only) Substring matching:
 *   - If old_string is a single line and Strategy 1 found nothing,
 *     try finding a content line that CONTAINS the normalized old line
 *     as a substring.
 *   - This handles cases where the AI omitted trailing punctuation/comments,
 *     e.g. old_string `mode: 'code'` matches `  mode: 'code', // comment`
 *
 * Returns match positions in the ORIGINAL (unnormalized) content.
 */
/** Export for testing */
export function findAllLinesSmart(content: string, oldString: string): MatchPos[] {
  // Strategy 1: Full line-by-line smart matching
  const matches = findLinesWithNormalizer(content, oldString, normalizeLineSmart)

  if (matches.length > 0) return matches

  // Strategy 2: For single-line old_string, try substring matching
  const oldLines = oldString.split('\n')
  if (oldLines.length !== 1) return []

  const contentLines = content.split('\n')
  const normOldLine = normalizeLineSmart(oldString)
  if (!normOldLine) return []

  for (let i = 0; i < contentLines.length; i++) {
    const normContentLine = normalizeLineSmart(contentLines[i]!)
    if (normContentLine.includes(normOldLine)) {
      let charPos = 0
      for (let k = 0; k < i; k++) {
        charPos += contentLines[k]!.length + 1
      }
      const lineLen = contentLines[i]!.length
      const matchedLen = contentLines[i]!.endsWith('\r') ? lineLen - 1 : lineLen
      matches.push({ index: charPos, length: matchedLen })
    }
  }

  return matches
}

/**
 * Fuzzy LCS-based fallback matcher.
 * Tries to find oldString lines in content by allowing up to `maxMismatchRatio`
 * of lines to be missing or differ. This catches cases where a few lines have
 * minor differences that even findAllLinesSmart couldn't handle.
 *
 * Only activates when old_string has at least 3 non-blank lines, to avoid
 * false positives on short old_strings.
 *
 * Returns the first best match found, or [] if even the fuzzy match fails.
 */
export function findAllLinesFuzzy(
  content: string,
  oldString: string,
  maxMismatchRatio: number = 0.2,
): MatchPos[] {
  const contentLines = content.split('\n')
  const oldLines = oldString.split('\n')
  if (oldLines.length === 0) return []

  // Only activate for multi-line edits (at least 3 non-blank lines)
  const nonBlankOld = oldLines.filter(l => l.trim())
  if (nonBlankOld.length < 3) return []

  // Build byte-position index for each content line
  const contentPositions: number[] = []
  let pos = 0
  for (let i = 0; i < contentLines.length; i++) {
    contentPositions.push(pos)
    pos += contentLines[i].length + 1 // +1 for \n
  }

  // Normalize old lines (skip blanks like the main matcher)
  const normOld: Array<{ line: string; orig: string; idx: number }> = []
  for (let i = 0; i < oldLines.length; i++) {
    const trimmed = oldLines[i].trim()
    if (!trimmed) continue
    normOld.push({ line: normalizeLine(trimmed), orig: trimmed, idx: i })
  }

  if (normOld.length < 3) return []

  const maxMismatches = Math.max(1, Math.floor(normOld.length * maxMismatchRatio))
  const minMatches = normOld.length - maxMismatches

  // Ensure at least 70% match rate
  const effectiveMin = Math.max(Math.ceil(normOld.length * 0.7), minMatches)

  let bestMatch: { start: number; matches: number } | null = null
  let bestMatches = -1

  for (let startIdx = 0; startIdx < contentLines.length; startIdx++) {
    let ci = startIdx
    let matches = 0
    let mismatches = 0

    for (const nOld of normOld) {
      if (ci >= contentLines.length) break
      if (normalizeLine(contentLines[ci]) === nOld.line) {
        matches++
        ci++
      } else {
        mismatches++
        // Try skipping 1-2 content lines
        let found = false
        for (let skip = 1; skip <= 2; skip++) {
          if (ci + skip >= contentLines.length) break
          if (normalizeLine(contentLines[ci + skip]) === nOld.line) {
            matches++
            ci = ci + skip + 1
            found = true
            break
          }
        }
        if (!found) {
          ci++
        }
      }

      if (mismatches > maxMismatches) break
    }

    if (matches > bestMatches) {
      bestMatches = matches
      bestMatch = { start: startIdx, matches }
    }

    if (matches >= effectiveMin) {
      // Good enough — compute byte position and length
      const endLine = Math.min(startIdx + normOld.length - 1, contentLines.length - 1)
      const byteStart = contentPositions[startIdx]
      const byteEnd = contentPositions[endLine] + contentLines[endLine].length
      return [{ index: byteStart, length: byteEnd - byteStart }]
    }
  }

  if (bestMatch && bestMatches >= effectiveMin) {
    const endLine = Math.min(bestMatch.start + normOld.length - 1, contentLines.length - 1)
    const byteStart = contentPositions[bestMatch.start]
    const byteEnd = contentPositions[endLine] + contentLines[endLine].length
    return [{ index: byteStart, length: byteEnd - byteStart }]
  }

  return []
}
