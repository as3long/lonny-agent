# Plan: Optimize edit tool with whitespace-tolerant matching

## Problem

The `edit` tool requires exact match via `content.indexOf(e.old_string)`. The AI frequently fails with "old_string not found" because whitespace differs **anywhere** on a line:

1. **Trailing spaces** — file has `"hello "`, AI sends `"hello"`
2. **Leading spaces** — file has `"  hello"`, AI sends `"hello"` (or different indent depth)
3. **Internal spaces** — file has `"foo  bar"` (two spaces), AI sends `"foo bar"` (one space)
4. **Blank line whitespace** — blank lines may have hidden spaces/tabs

Each failure costs a full tool call cycle.

## Strategy (2-tier matching)

### Tier 1: Exact match (current)
`content.indexOf(e.old_string)` — fast, correct for most cases.

### Tier 2: Whitespace-normalized line matching (fallback)
Only when Tier 1 fails. Normalize each line before comparing:

```
normalize(s) = s.trim().replace(/[ \t]{2,}/g, ' ')
```

This handles whitespace differences **anywhere on the line**:
- **Leading spaces** → `trim()` removes them
- **Trailing spaces** → `trim()` removes them
- **Extra internal spaces** → `"foo  bar"` → `"foo bar"`
- **Blank lines with spaces** → `"   "` → `""`

**Why this is safe (low false-positive risk):**
- Only collapses 2+ consecutive whitespace chars, not single spaces
- Single spaces between tokens are preserved
- Line structure is preserved (matching is per-line, not cross-line)

### Matching algorithm

```
findAllLinesTolerant(content, oldString):
  contentLines = content.split('\n')
  oldLines = oldString.split('\n')
  
  for startLine = 0 .. contentLines.length - oldLines.length:
    match = true
    for j = 0 .. oldLines.length:
      if normalize(contentLines[startLine+j]) != normalize(oldLines[j]):
        match = false; break
    if match:
      charPos = sum of lengths of contentLines[0..startLine-1] + newlines
      matchedLen = sum of lengths of contentLines[startLine..startLine+oldLines.length-1] + newlines
      add { index: charPos, length: matchedLen } to results
  
  return results
```

Position/length is computed in the **original** (unnormalized) content, so `slice()` replacement works correctly.

## Files to modify

### `src/tools/edit.ts`

**1. Add normalize helper + findAllLinesTolerant:**

```typescript
/** Normalize a single line: trim both ends + collapse 2+ whitespace runs into 1 space. */
function normalizeLine(s: string): string {
  return s.trim().replace(/[ \t]{2,}/g, ' ')
}

interface MatchPos {
  index: number
  length: number
}

/**
 * Sliding-window line search that ignores whitespace differences
 * (leading, trailing, and internal runs). Returns all match positions
 * in the ORIGINAL (unnormalized) content.
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
      if (normContent[start + j] !== normOld[j]) { match = false; break }
    }
    if (match) {
      let charPos = 0
      for (let k = 0; k < start; k++) charPos += contentLines[k].length + 1
      let matchedLen = 0
      for (let j = 0; j < oldLines.length; j++) {
        matchedLen += contentLines[start + j].length
        if (j < oldLines.length - 1) matchedLen += 1
      }
      matches.push({ index: charPos, length: matchedLen })
    }
  }
  return matches
}
```

**2. Modify the matching block** (current lines 216-247):

Replace:
```typescript
const idx = content.indexOf(e.old_string)
if (idx === -1) { /* fail */ }
const lastIdx = content.lastIndexOf(e.old_string)
if (idx !== lastIdx) { /* duplicate fail */ }
// apply
```

With:
```typescript
let matchInfo: { index: number; length: number; strategy: 'exact' | 'tolerant' } | null = null

// Tier 1: Exact match
const exactIdx = content.indexOf(e.old_string)
if (exactIdx !== -1) {
  matchInfo = { index: exactIdx, length: e.old_string.length, strategy: 'exact' }
}

// Tier 2: Whitespace-normalized fallback
if (!matchInfo) {
  const tolerant = findAllLinesTolerant(content, e.old_string)
  if (tolerant.length === 1) {
    matchInfo = { ...tolerant[0], strategy: 'tolerant' }
  } else if (tolerant.length > 1) {
    // duplicate in tolerant mode
    diag = JSON.stringify({ file_path, old_string, new_string })
    results.push(`  FAIL ${relPath}: old_string appears MULTIPLE times (whitespace-normalized) — ${diag}`)
    // ... fail + break
  }
}

if (!matchInfo) {
  diag = JSON.stringify({ file_path, old_string, new_string })
  results.push(`  FAIL ${relPath}: old_string not found — ${diag}`)
  // ... fail + break
}

// Check duplicates for exact match
if (matchInfo.strategy === 'exact') {
  const lastIdx = content.lastIndexOf(e.old_string)
  if (exactIdx !== lastIdx) {
    // ... duplicate error (same as before)
  }
}

// Apply edit
const prefix = matchInfo.strategy === 'tolerant' ? ' (whitespace-normalized)' : ''
const diff = generateDiff(e.old_string, e.new_string)
results.push(`  Edited ${relPath}${prefix}:\n${diff}`)
content = content.slice(0, matchInfo.index) + e.new_string + content.slice(matchInfo.index + matchInfo.length)
```

**3. Improve "not found" diagnostic** — when all strategies fail, show proximity info:

```typescript
// Show what's near the first line of old_string in the file
const firstLine = e.old_string.split('\n')[0] || ''
const contentLines = content.split('\n')
const similarLine = contentLines.findIndex(l => normalizeLine(l).includes(normalizeLine(firstLine)))
let hint = ''
if (similarLine !== -1) {
  const context = contentLines.slice(Math.max(0, similarLine - 1), similarLine + 2).join('\n')
  hint = `\n  Closest match at line ${similarLine + 1}:\n  """\n${context}\n  """"`
}
results.push(`  FAIL ${relPath}: old_string not found — ${diag}${hint}`)
```

## Test cases

All in `src/tools/__tests__/edit.test.ts`, new `describe('whitespace tolerance', ...)` block.

| # | Test name | File content | old_string | Expected |
|---|-----------|-------------|------------|----------|
| 1 | `trailing space in file` | `"hello \nworld\n"` | `"hello\nworld"` | Match tolerant |
| 2 | `trailing space in old_string` | `"hello\nworld\n"` | `"hello \nworld"` | Match tolerant |
| 3 | `leading space in file` | `"  hello\nworld\n"` | `"hello\nworld"` | Match tolerant |
| 4 | `leading space in old_string` | `"hello\nworld\n"` | `"  hello\nworld"` | Match tolerant |
| 5 | `extra internal spaces in file` | `"foo  bar\nbaz\n"` | `"foo bar\nbaz"` | Match tolerant |
| 6 | `extra internal spaces in old_string` | `"foo bar\nbaz\n"` | `"foo  bar\nbaz"` | Match tolerant |
| 7 | `blank line with spaces` | `"foo\n   \nbar\n"` | `"foo\n\nbar"` | Match tolerant |
| 8 | `mixed whitespace multi-line` | `"  a  \nb \nc\n"` | `"a\nb\nc"` | Match tolerant |
| 9 | `no match when text differs` | `"hello\nworld\n"` | `"hello\nmundo"` | Fail — text differs |
| 10 | `no match when too different` | `"hello\nworld\n"` | `"zzz\nzzz"` | Fail |
| 11 | `duplicate tolerant mode` | `"a  \nb\nc\n"` `"a\nb\nd\n"` | `"a\nb"` | Duplicate fail |
| 12 | `exact match preferred` | `"hello\nworld\n"` | `"hello\nworld"` | Exact match (no "normalized" note) |
| 13 | `internal multiple spaces collapsed` | `"x  =  1\ny\n"` | `"x = 1\ny"` | Match tolerant |
| 14 | `single line trailing space` | `"hello  "` | `"hello"` | Match tolerant |
| 15 | `single line leading space` | `"  hello"` | `"hello"` | Match tolerant |

## Todo List

- [x] Switch to code mode
- [x] Add `normalizeLine()` and `findAllLinesTolerant()` helpers after `generateDiff()`
- [x] Modify matching logic with 2-tier strategy (exact + whitespace-normalized)
- [x] Improve "not found" diagnostic with proximity hint (shows matched lines or first 5 lines)
- [x] Add test cases (15 test cases in `edit.test.ts`)
- [x] Run tests — all 33 pass
- [x] Build — passes
