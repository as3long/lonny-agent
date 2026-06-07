// copy:native — recursively copies src/pi-tui/native/ to dist/pi-tui/native/
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('..', import.meta.url))

function cpDir(s, d) {
  mkdirSync(d, { recursive: true })
  for (const e of readdirSync(s)) {
    const sp = join(s, e)
    const dp = join(d, e)
    if (statSync(sp).isDirectory()) {
      cpDir(sp, dp)
    } else {
      copyFileSync(sp, dp)
    }
  }
}

const src = join(__dirname, 'src', 'pi-tui', 'native')
const dst = join(__dirname, 'dist', 'pi-tui', 'native')

if (existsSync(src)) cpDir(src, dst)
