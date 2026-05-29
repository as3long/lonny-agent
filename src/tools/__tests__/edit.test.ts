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
      expect(r.output).toContain('+ hello')
      expect(r.output).toContain('+ world')
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
      expect(r.output).toContain('- line two')
      // Should contain green ANSI code for added content
      expect(r.output).toContain('\x1b[38;2;0;200;100m')
      expect(r.output).toContain('+ line TWO')
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
      // Removed lines
      expect(r.output).toContain('- line one')
      expect(r.output).toContain('- line TWO')
      // Added lines
      expect(r.output).toContain('+ line 1')
      expect(r.output).toContain('+ line 2')
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
      expect(r.output).toContain('- b')
      expect(r.output).toContain('+ B')
    })

    it('does not show empty red line when old_string is empty', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'empty-old.txt', old_string: '', new_string: 'only added' }],
      })
      expect(r.success).toBe(true)
      // Should have green + lines
      expect(r.output).toContain('+ only added')
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
})
