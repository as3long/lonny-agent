import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileReadTracker } from '../../diff/apply.js'
import { createEditTool } from '../edit.js'
import { makeTempDir } from './helpers.js'

describe('edit tool', () => {
  let tmpDir: string
  let applier: FileReadTracker

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\nline three\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'foo\nbar\nbaz\n')
    applier = new FileReadTracker()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  describe('single edit mode', () => {
    beforeAll(() => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\nline three\n')
      fs.writeFileSync(path.join(tmpDir, 'dup.txt'), 'abc\ndef\nabc\n')
    })

    it('replaces an exact string', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', old_string: 'line two', new_string: 'line TWO' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toContain('line TWO')
    })

    it('replaces multi-line string', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'a.txt',
            old_string: 'line one\nline TWO',
            new_string: 'line 1\nline 2',
          },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')
      expect(content).toContain('line 1')
      expect(content).toContain('line 2')
    })

    it('reports old_string not found', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', old_string: 'nonexistent', new_string: 'x' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('reports duplicate old_string', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'dup.txt', old_string: 'abc', new_string: 'xyz' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('MULTIPLE times')
    })

    it('auto-corrects flat file_path/old_string/new_string into edits array', async () => {
      // The tool auto-corrects { file_path, old_string, new_string }
      // into { edits: [{ file_path, old_string, new_string }] }
      // So the error should be about file not found, not 'edits' missing
      const r = await tool().execute({ file_path: 'x', old_string: 'y', new_string: 'z' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('reports file not found', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'nonexistent.txt', old_string: 'x', new_string: 'y' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })
  })

  describe('validation', () => {
    beforeAll(() => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'test content\n')
    })

    it('rejects edit missing old_string', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', new_string: 'replacement' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('missing')
      expect(r.error).toContain('old_string')
    })

    it('rejects edit missing new_string', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', old_string: 'original' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('missing')
      expect(r.error).toContain('new_string')
    })

    it('rejects edit missing file_path', async () => {
      const r = await tool().execute({
        edits: [{ old_string: 'a', new_string: 'b' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('missing')
      expect(r.error).toContain('file_path')
    })

    it('reports all missing fields in one error', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'a.txt', old_string: 'a', new_string: 'b' },
          { file_path: 'a.txt', new_string: 'c' },
          { file_path: 'a.txt', old_string: 'd' },
        ],
      })
      expect(r.success).toBe(false)
      // Should report BOTH errors, not just the first
      expect(r.error).toContain('2 of 3')
      expect(r.error).toContain('edit #2')
      expect(r.error).toContain('edit #3')
      // Should mention not to split across edits
      expect(r.error).toContain('COMPLETE')
    })

    it('reports which fields each malformed edit has', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', new_string: 'c' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('has: file_path, new_string')
    })

    it('includes rawInput in the error message', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'a.txt', new_string: 'c' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('a.txt')
      expect(r.error).toContain('new_string')
    })
  })

  describe('auto-correction', () => {
    it('wraps top-level file_path/old_string/new_string into edits array', async () => {
      const r = await tool().execute({
        file_path: 'nonexistent.ts',
        old_string: 'x',
        new_string: 'y',
      })
      // Should be auto-corrected so the error is about file not found, not about missing edits
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('wraps flat file_path + old_string (missing new_string) with default empty new_string', async () => {
      const r = await tool().execute({
        file_path: path.join(tmpDir, 'new.txt'),
        old_string: '',
      })
      // Auto-corrected to { edits: [{ file_path, old_string: '', new_string: '' }] }
      // This creates a file with empty content
      expect(r.success).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, 'new.txt'))).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'new.txt'), 'utf8')).toBe('')
      fs.unlinkSync(path.join(tmpDir, 'new.txt'))
    })

    it('handles edits passed directly as an array (not wrapped)', async () => {
      // @ts-expect-error — runtime accepts array, TS expects object
      const r = await tool().execute([
        { file_path: 'a.txt', old_string: 'test', new_string: 'TEST' },
      ])
      expect(r.success).toBe(true)
    })

    it('handles file_path + new_string (no old_string) at top level as create', async () => {
      const r = await tool().execute({
        file_path: path.join(tmpDir, 'auto-create.txt'),
        new_string: 'auto created',
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'auto-create.txt'), 'utf8')).toBe('auto created')
      fs.unlinkSync(path.join(tmpDir, 'auto-create.txt'))
    })

    it('handles only file_path at top level as empty file creation', async () => {
      const r = await tool().execute({
        file_path: path.join(tmpDir, 'empty-file.txt'),
      })
      expect(r.success).toBe(true)
      expect(fs.existsSync(path.join(tmpDir, 'empty-file.txt'))).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'empty-file.txt'), 'utf8')).toBe('')
      fs.unlinkSync(path.join(tmpDir, 'empty-file.txt'))
    })

    it('rejects nonsensical top-level keys with helpful error', async () => {
      const r = await tool().execute({ foo: 'bar' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('edits')
      expect(r.error).toContain('array')
    })
  })

  describe('batch mode', () => {
    beforeAll(() => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'one\ntwo\nthree\nfour\n')
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'foo\nbar\nbaz\n')
    })

    it('applies multiple edits to one file', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'a.txt', old_string: 'one', new_string: 'ONE' },
          { file_path: 'a.txt', old_string: 'three', new_string: 'THREE' },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')
      expect(content).toContain('ONE')
      expect(content).toContain('THREE')
      expect(content).toContain('two')
    })

    it('applies edits across multiple files', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'a.txt', old_string: 'ONE', new_string: 'one' },
          { file_path: 'b.txt', old_string: 'foo\nbar', new_string: 'FOO\nBAR' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toContain('one')
      expect(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8')).toContain('FOO')
      expect(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8')).toContain('BAR')
    })

    it('rolls back all changes on failure', async () => {
      const original = fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')

      const r = await tool().execute({
        edits: [
          { file_path: 'a.txt', old_string: 'THREE', new_string: 'three' },
          { file_path: 'a.txt', old_string: 'zzz_nonexistent_zzz', new_string: 'FAIL' },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('rolled back')
      expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toBe(original)
    })

    it('rolls back multi-file on any failure', async () => {
      const origA = fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')
      const origB = fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8')

      const r = await tool().execute({
        edits: [
          { file_path: 'a.txt', old_string: 'four', new_string: 'FOUR' },
          { file_path: 'missing.txt', old_string: 'x', new_string: 'y' },
        ],
      })
      expect(r.success).toBe(false)
      expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toBe(origA)
      expect(fs.readFileSync(path.join(tmpDir, 'b.txt'), 'utf8')).toBe(origB)
    })

    it('rejects empty edits array', async () => {
      const r = await tool().execute({ edits: [] })
      expect(r.success).toBe(false)
      expect(r.error).toContain('empty')
    })
  })

  describe('diff output', () => {
    beforeAll(() => {
      fs.writeFileSync(path.join(tmpDir, 'diff-test.txt'), 'line one\nline two\nline three\n')
    })

    it('shows green + for new file creation (no red - lines)', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'diff-new.txt', old_string: '', new_string: 'hello\nworld' }],
      })
      expect(r.success).toBe(true)
      // Should contain green ANSI code for added lines
      expect(r.output).toContain('\x1b[38;2;0;200;100m') // green
      expect(r.output).toContain('hello')
      expect(r.output).toContain('world')
      // Should NOT contain red ANSI code (no removed lines)
      expect(r.output).not.toContain('\x1b[38;2;255;80;80m')
      expect(r.output).toContain('Created')
    })

    it('shows red - for removed lines and green + for added lines on replacement', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'diff-test.txt',
            old_string: 'line two',
            new_string: 'line TWO',
          },
        ],
      })
      expect(r.success).toBe(true)
      // Should contain red ANSI code for removed content
      expect(r.output).toContain('\x1b[38;2;255;80;80m')
      expect(r.output).toContain('line two')
      // Should contain green ANSI code for added content
      expect(r.output).toContain('\x1b[38;2;0;200;100m')
      expect(r.output).toContain('line TWO')
      expect(r.output).toContain('Edited')
    })

    it('shows multi-line diff correctly', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'diff-test.txt',
            old_string: 'line one\nline TWO',
            new_string: 'line 1\nline 2',
          },
        ],
      })
      expect(r.success).toBe(true)
      // Removed lines (red)
      expect(r.output).toContain('\x1b[38;2;255;80;80mline one')
      expect(r.output).toContain('\x1b[38;2;255;80;80mline TWO')
      // Added lines (green)
      expect(r.output).toContain('\x1b[38;2;0;200;100mline 1')
      expect(r.output).toContain('\x1b[38;2;0;200;100mline 2')
    })

    it('handles CRLF in old_string (Windows compatibility)', async () => {
      fs.writeFileSync(path.join(tmpDir, 'crlf-test.txt'), 'a\\r\\nb\\r\\nc\\r\\n')
      const r = await tool().execute({
        edits: [
          {
            file_path: 'crlf-test.txt',
            // Simulate AI sending old_string with \\r\\n (CRLF) on Windows
            old_string: 'b\\r\\n',
            new_string: 'B\\r\\n',
          },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(path.join(tmpDir, 'crlf-test.txt'), 'utf8')
      expect(content).toContain('B')
      // Should show the normalized diff (with \\n, not \\r\\n)
      expect(r.output).toContain('\x1b[38;2;255;80;80mb')
      expect(r.output).toContain('\x1b[38;2;0;200;100mB')
    })

    it('does not show empty red line when old_string is empty', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'empty-old.txt', old_string: '', new_string: 'only added' }],
      })
      expect(r.success).toBe(true)
      // Should have green colored line
      expect(r.output).toContain('\x1b[38;2;0;200;100monly added')
      // Count red-start markers — should be 0 (no removed content)
      const redCount = (r.output.match(/\x1b\[38;2;255;80;80m/g) || []).length
      expect(redCount).toBe(0)
    })
  })

  describe('create mode', () => {
    const createdDir = () => path.join(tmpDir, 'created-test')

    afterAll(() => {
      fs.rmSync(createdDir(), { recursive: true, force: true })
    })

    it('creates a new file with empty old_string', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'created-test/new.ts',
            old_string: '',
            new_string: 'const x = 1\nexport { x }',
          },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(path.join(createdDir(), 'new.ts'), 'utf8')
      expect(content).toBe('const x = 1\nexport { x }')
    })

    it('creates a file in batch mode', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'created-test/a.ts', old_string: '', new_string: '// a' },
          { file_path: 'created-test/b.ts', old_string: '', new_string: '// b' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(createdDir(), 'a.ts'), 'utf8')).toBe('// a')
      expect(fs.readFileSync(path.join(createdDir(), 'b.ts'), 'utf8')).toBe('// b')
    })

    it('rejects create when file already exists', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'created-test/new.ts',
            old_string: '',
            new_string: 'x',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('already exists')
    })

    it('rolls back on create failure in batch', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'created-test/rollback-1.ts', old_string: '', new_string: 'keep me' },
          { file_path: 'created-test/rollback-1.ts', old_string: '', new_string: 'duplicate' },
        ],
      })
      expect(r.success).toBe(false)
      expect(fs.existsSync(path.join(createdDir(), 'rollback-1.ts'))).toBe(false)
    })
  })

  describe('whitespace tolerance', () => {
    const wsDir = () => path.join(tmpDir, 'ws-test')
    const f = (name: string) => path.join(wsDir(), name)

    beforeAll(() => {
      fs.mkdirSync(wsDir(), { recursive: true })
    })

    const tool = () => createEditTool(applier, wsDir())

    it('handles trailing space in file (AI omits trailing space)', async () => {
      fs.writeFileSync(f('trailing.txt'), 'hello \nworld\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'trailing.txt', old_string: 'hello\nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('trailing.txt'), 'utf8')).toBe('HELLO\nWORLD\n')
      // Should indicate whitespace-normalized in output
      expect(r.output).toContain('whitespace-normalized')
    })

    it('handles trailing space in old_string (AI adds extra trailing space)', async () => {
      fs.writeFileSync(f('trailing.txt'), 'hello \nworld\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'trailing.txt', old_string: 'hello \nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('trailing.txt'), 'utf8')).toBe('HELLO\nWORLD\n')
    })

    it('handles leading space in file (AI omits leading indent)', async () => {
      fs.writeFileSync(f('leading.txt'), '  hello\nworld\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'leading.txt', old_string: 'hello\nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      // Leading spaces in the original file become part of the matched block
      // and are preserved in the result
      expect(fs.readFileSync(f('leading.txt'), 'utf8')).toBe('  HELLO\nWORLD\n')
    })

    it('handles leading space in old_string (AI adds extra indent)', async () => {
      fs.writeFileSync(f('leading.txt'), '  hello\nworld\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'leading.txt', old_string: '    hello\nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      // The file's leading spaces are part of the matched block, so they
      // get replaced along with the rest of the matched text
      expect(fs.readFileSync(f('leading.txt'), 'utf8')).toBe('HELLO\nWORLD\n')
    })

    it('handles extra internal spaces in file (AI sends single space)', async () => {
      fs.writeFileSync(f('internal.txt'), 'foo  bar\nbaz\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'internal.txt', old_string: 'foo bar\nbaz', new_string: 'FOO BAR\nBAZ' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('internal.txt'), 'utf8')).toBe('FOO BAR\nBAZ\n')
    })

    it('handles extra internal spaces in old_string (AI adds double space)', async () => {
      fs.writeFileSync(f('internal.txt'), 'foo  bar\nbaz\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'internal.txt', old_string: 'foo  bar\nbaz', new_string: 'FOO BAR\nBAZ' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('internal.txt'), 'utf8')).toBe('FOO BAR\nBAZ\n')
    })

    it('handles blank line with spaces matching empty blank line', async () => {
      fs.writeFileSync(f('blank.txt'), 'foo\n   \nbar\n')
      const r = await tool().execute({
        edits: [{ file_path: 'blank.txt', old_string: 'foo\n\nbar', new_string: 'FOO\n\nBAR' }],
      })
      expect(r.success).toBe(true)
      // The blank line with spaces is part of the matched block and gets
      // replaced entirely by the new_string's blank line
      expect(fs.readFileSync(f('blank.txt'), 'utf8')).toBe('FOO\n\nBAR\n')
    })

    it('handles mixed whitespace across multiple lines', async () => {
      fs.writeFileSync(f('mixed.txt'), '  a  \nb \nc\n')
      const r = await tool().execute({
        edits: [{ file_path: 'mixed.txt', old_string: 'a\nb\nc', new_string: 'A\nB\nC' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('mixed.txt'), 'utf8')).toBe('A\nB\nC\n')
    })

    it('still fails when text content differs (not just whitespace)', async () => {
      fs.writeFileSync(f('trailing.txt'), 'hello \nworld\n')
      const r = await tool().execute({
        edits: [{ file_path: 'trailing.txt', old_string: 'hello\nmundo', new_string: 'x\ny' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('still fails for completely wrong old_string', async () => {
      fs.writeFileSync(f('trailing.txt'), 'hello \nworld\n')
      const r = await tool().execute({
        edits: [{ file_path: 'trailing.txt', old_string: 'zzz\nzzz', new_string: 'x\ny' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('reports duplicate in whitespace-normalized mode', async () => {
      fs.writeFileSync(f('duplicate.txt'), 'a  \nb\na  \nb\n')
      const r = await tool().execute({
        edits: [{ file_path: 'duplicate.txt', old_string: 'a\nb', new_string: 'X\nY' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('MULTIPLE times')
      expect(r.error).toContain('whitespace-normalized')
    })

    it('prefers exact match when available', async () => {
      fs.writeFileSync(f('exact-prefer.txt'), 'hello\nworld\n')
      const r = await tool().execute({
        edits: [
          { file_path: 'exact-prefer.txt', old_string: 'hello\nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(f('exact-prefer.txt'), 'utf8')).toBe('HELLO\nWORLD\n')
      // Exact match should NOT have the whitespace-normalized note
      expect(r.output).not.toContain('whitespace-normalized')
    })

    it('provides context snippet when old_string not found', async () => {
      fs.writeFileSync(f('trailing.txt'), 'hello \nworld\n')
      const r = await tool().execute({
        edits: [{ file_path: 'trailing.txt', old_string: 'nonexistent_line_xyz', new_string: 'x' }],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
      // Should contain a snippet with the file's actual content
      expect(r.error).toContain('hello')
    })
  })
})
