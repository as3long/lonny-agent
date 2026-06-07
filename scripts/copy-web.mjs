// copy:web — copies src/web/public/ to dist/web/public/
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('..', import.meta.url))
const src = join(__dirname, 'src', 'web', 'public')
const dst = join(__dirname, 'dist', 'web', 'public')

if (existsSync(src)) {
  if (!existsSync(dst)) mkdirSync(dst, { recursive: true })
  for (const f of readdirSync(src)) {
    copyFileSync(join(src, f), join(dst, f))
  }
}
