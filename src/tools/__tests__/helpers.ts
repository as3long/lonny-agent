import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

export function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-test-'))
}
