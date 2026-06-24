import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

// 鈹€鈹€ Language detection 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/** Detect file language by extension for indentation fixing. */
export function detectLanguage(
  filePath: string,
): 'typescript' | 'javascript' | 'python' | null {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') return 'typescript'
  if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript'
  if (ext === '.py') return 'python'
  return null
}

// 鈹€鈹€ Main entry point 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * Fix indentation for a file after editing. Dispatches to language-specific
 * fixers. This is best-effort 鈥?failures are silently caught.
 *
 * @param filePath - Absolute path to the file
 * @param cwd - Working directory (used to find node_modules for Biome)
 */
export function fixFileIndentation(filePath: string, cwd: string): void {
  const lang = detectLanguage(filePath)
  if (!lang) return

  switch (lang) {
    case 'typescript':
    case 'javascript':
      fixWithBiome(filePath, cwd)
      break
    case 'python':
      fixPythonIndentation(filePath)
      break
  }
}

// 鈹€鈹€ Biome formatter for TypeScript/JavaScript 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * Format a TypeScript/JavaScript file using Biome's CLI.
 * Biome is already a dependency of the project.
 */
function fixWithBiome(filePath: string, cwd: string): void {
  // Resolve the biome binary relative to the project root
  const biomeBin = findBiomeBin(cwd)
  if (!biomeBin) return

  try {
    execFileSync(process.execPath, [biomeBin, 'format', '--write', filePath], {
      cwd,
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    })
  } catch {
    // Silently ignore 鈥?biome might not be installed, or the file has syntax errors
  }
}

/**
 * Find the biome.js entry point in node_modules.
 * Returns null if not found.
 */
function findBiomeBin(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'node_modules', '@biomejs', 'biome', 'bin', 'biome.js'),
    path.join(cwd, '..', 'node_modules', '@biomejs', 'biome', 'bin', 'biome.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

// 鈹€鈹€ Python indentation fixer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * Fix indentation for a Python file.
 * Operations performed:
 * 1. Normalize tabs to 4 spaces
 * 2. Detect the file's indent width from existing consistent indentation
 * 3. Re-indent lines based on block structure (if/def/class/for/while/try/etc.)
 */
function fixPythonIndentation(filePath: string): void {
  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return // File doesn't exist or can't be read 鈥?skip
  }

  if (!content.trim()) return

  const lines = content.split('\n')

  // Step 1: Normalize tabs to 4 spaces
  const tabNormalized = lines.map(l => l.replace(/\t/g, '    '))

  // Step 2: Detect indent width (for reference)
  const indentWidth = detectPythonIndentWidth(tabNormalized)
  if (!indentWidth) {
    // No indented lines 鈥?write back tab-normalized version
    const result = tabNormalized.join('\n')
    if (result !== content) {
      fs.writeFileSync(filePath, result, 'utf-8')
    }
    return
  }

  // Step 3: Re-indent
  // Always normalize Python to 4-space indent
  const targetWidth = 4
  const reindented = reindentPythonLines(tabNormalized, targetWidth)
  const result = reindented.join('\n')

  // Step 4: Write back only if changed
  if (result !== content) {
    fs.writeFileSync(filePath, result, 'utf-8')
  }
}

/**
 * Detect the most common indentation width in a Python file.
 * Looks at leading whitespace of non-blank lines and finds the most
 * common non-zero indent width.
 */
export function detectPythonIndentWidth(lines: string[]): number | null {
  const widths = new Map<number, number>() // width 鈫?count

  for (const line of lines) {
    const trimmed = line.trimStart()
    if (!trimmed || trimmed === line) continue // skip blank or non-indented lines

    const leadingSpaces = line.length - trimmed.length
    if (leadingSpaces > 0 && line[leadingSpaces - 1] !== ' ') {
      // Last character before content is not a space 鈥?likely a tab that's been missed
      continue
    }

    // Normalize: consider divisors of common indent widths
    // This helps detect files where inconsistent indentation exists
    if (widths.has(leadingSpaces)) {
      widths.set(leadingSpaces, widths.get(leadingSpaces)! + 1)
    } else {
      widths.set(leadingSpaces, 1)
    }
  }

  if (widths.size === 0) return null

  // Find the most frequent indent width
  let bestWidth = 0
  let bestCount = 0
  for (const [width, count] of widths) {
    if (count > bestCount) {
      bestCount = count
      bestWidth = width
    }
  }

  // Common Python indent widths
  const commonWidths = [4, 2, 8]
  for (const w of commonWidths) {
    if (widths.has(w) && widths.get(w)! >= bestCount * 0.5) {
      return w
    }
  }

  // Fall back to the most frequent width if it is a common Python width
  const commonWidthSet = new Set([4, 2, 8])
  if (commonWidthSet.has(bestWidth)) return bestWidth

  // Default to 4 for Python
  return 4
}

/**
 * Python keywords that start a new indented block.
 */
const PY_BLOCK_OPENERS = new Set([
  'if',
  'elif',
  'else',
  'for',
  'while',
  'def',
  'class',
  'try',
  'except',
  'finally',
  'with',
  'async',
  'match',
  'case',
])

/**
 * Python keywords that should be at the same indent level as the matching
 * block opener (dedent keywords).
 */
const PY_DEDENT_KEYWORDS = new Set(['elif', 'else', 'except', 'finally', 'case'])

/**
 * Re-indent Python lines based on block structure.
 * Uses a stack to track the current indent level.
 */
function reindentPythonLines(lines: string[], indentWidth: number): string[] {
  const result: string[] = []
  // Stack of indent levels. First entry is always 0 (file scope).
  const indentStack = [0]
  // Also track which lines were block-openers (for dedent alignment)
  const blockStack: string[] = []

  for (const rawLine of lines) {
    const stripped = rawLine.trim()

    if (!stripped || stripped.startsWith('#')) {
      // Blank line or comment 鈥?preserve as-is
      result.push(rawLine)
      continue
    }

    // Get the first significant word (before space, colon, paren)
    const firstWord = stripped.split(/[\s(:]/)[0]

    // 鈹€鈹€ Handle dedent keywords 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // These should be at the same level as their matching block opener
    if (PY_DEDENT_KEYWORDS.has(firstWord) && indentStack.length > 1) {
      // Pop the block level
      indentStack.pop()
      blockStack.pop()
    }

    // Determine expected indent for this line
    const expectedIndent = indentStack[indentStack.length - 1] ?? 0

    // Re-indent this line
    const indent = ' '.repeat(expectedIndent)
    result.push(indent + stripped)

    // 鈹€鈹€ Check if this line opens a new block 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    // A block opener ends with ':' (after removing inline comments)
    const codeForCheck = stripped.split('#')[0]?.trimEnd() || stripped
    if (codeForCheck.endsWith(':') && PY_BLOCK_OPENERS.has(firstWord)) {
      // Push new indent level
      indentStack.push(expectedIndent + indentWidth)
      blockStack.push(firstWord)
    }
  }

  return result
}