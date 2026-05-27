import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-test-'))
}
