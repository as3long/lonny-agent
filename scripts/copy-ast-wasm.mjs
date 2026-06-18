import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const targets = [
  join(__dirname, '..', 'src', 'tools', 'codebase', 'ast', 'wasm'),
  join(__dirname, '..', 'dist', 'tools', 'codebase', 'ast', 'wasm'),
]

const wasmMap = [
  { id: 'web-tree-sitter/web-tree-sitter.wasm', out: 'web-tree-sitter.wasm' },
  { id: 'tree-sitter-typescript/tree-sitter-typescript.wasm', out: 'tree-sitter-typescript.wasm' },
  { id: 'tree-sitter-typescript/tree-sitter-tsx.wasm', out: 'tree-sitter-tsx.wasm' },
  { id: 'tree-sitter-python/tree-sitter-python.wasm', out: 'tree-sitter-python.wasm' },
]

for (const dest of targets) {
  mkdirSync(dest, { recursive: true })
  for (const { id, out } of wasmMap) {
    try {
      const src = require.resolve(id)
      copyFileSync(src, join(dest, out))
      console.log(`  ✓ ${dest.endsWith('wasm') ? out : out} → ${dest.slice(dest.indexOf('tools'))}`)
    } catch (err) {
      console.warn(`  ⚠ Failed to copy ${out}: ${err.message}`)
    }
  }
}
