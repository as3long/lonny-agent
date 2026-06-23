import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const root = join(__dirname, '..')

const targets = [
  join(root, 'src', 'tools', 'codebase', 'ast', 'wasm'),
  join(root, 'dist', 'tools', 'codebase', 'ast', 'wasm'),
]

const wasmMap = [
  { id: 'web-tree-sitter/web-tree-sitter.wasm', out: 'web-tree-sitter.wasm' },
  { id: 'tree-sitter-typescript/tree-sitter-typescript.wasm', out: 'tree-sitter-typescript.wasm' },
  { id: 'tree-sitter-typescript/tree-sitter-tsx.wasm', out: 'tree-sitter-tsx.wasm' },
  { id: 'tree-sitter-python/tree-sitter-python.wasm', out: 'tree-sitter-python.wasm' },
]

function md5(filePath) {
  return createHash('md5').update(readFileSync(filePath)).digest('hex')
}

for (const dest of targets) {
  mkdirSync(dest, { recursive: true })
  for (const { id, out } of wasmMap) {
    try {
      const src = require.resolve(id)
      const outPath = join(dest, out)
      if (existsSync(outPath) && md5(src) === md5(outPath)) {
        continue
      }
      copyFileSync(src, outPath)
      console.log(`  ✓ ${relative(root, outPath)}`)
    } catch (err) {
      console.warn(`  ⚠ Failed to copy ${out}: ${err.message}`)
    }
  }
}
