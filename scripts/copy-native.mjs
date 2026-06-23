// copy:native — recursively copies src/pi-tui/native/ to dist/pi-tui/native/
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('..', import.meta.url))
const root = __dirname

function md5(filePath) {
  return createHash('md5').update(readFileSync(filePath)).digest('hex')
}

let copied = 0
let skipped = 0

function cpDir(s, d) {
  mkdirSync(d, { recursive: true })
  for (const e of readdirSync(s)) {
    const sp = join(s, e)
    const dp = join(d, e)
    if (statSync(sp).isDirectory()) {
      cpDir(sp, dp)
    } else {
      if (existsSync(dp) && md5(sp) === md5(dp)) {
        skipped++
        continue
      }
      copyFileSync(sp, dp)
      copied++
      console.log(`  ✓ ${relative(root, dp)}`)
    }
  }
}

const src = join(__dirname, 'src', 'pi-tui', 'native')
const dst = join(__dirname, 'dist', 'pi-tui', 'native')

if (existsSync(src)) {
  cpDir(src, dst)
  if (copied > 0) console.log(`  Copied ${copied} file(s), skipped ${skipped} unchanged`)
}
