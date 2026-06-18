import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_LINES = 500
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')

/** Recursively collect .ts files in a directory (skip node_modules, dist, __tests__). */
function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '__tests__' ||
        entry.name === 'pi-tui' ||
        entry.name.startsWith('.')
      )
        continue
      files.push(...walk(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full)
    }
  }
  return files
}

let exitCode = 0
const files = walk(SRC)

for (const file of files) {
  try {
    const content = readFileSync(file, 'utf-8')
    const lines = content.split('\n').length
    if (lines > MAX_LINES) {
      const rel = relative(ROOT, file).replace(/\\/g, '/')
      console.log(`⚠  ${rel} (${lines} lines) exceeds ${MAX_LINES}-line limit`)
      exitCode = 1
    }
  } catch {
    // skip unreadable files
  }
}

if (exitCode === 0) {
  console.log(`✓ All ${files.length} source files are under ${MAX_LINES} lines`)
}
process.exit(exitCode)
