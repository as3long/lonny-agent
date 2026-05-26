import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createEditTool } from '../edit.js'
import { PatchApplier } from '../../diff/apply.js'
import { makeTempDir } from './helpers.js'

describe('edit tool', () => {
  let tmpDir: string
  let applier: PatchApplier

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\nline three\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'foo\nbar\nbaz\n')
    applier = new PatchApplier()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  describe('single edit mode', () => {
    beforeAll(() => {
      // Reset a.txt to known state
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\nline three\n')
      fs.writeFileSync(path.join(tmpDir, 'dup.txt'), 'abc\ndef\nabc\n')
    })

    it('replaces an exact string', async () => {
      const r = await tool().execute({ file_path: 'a.txt', old_string: 'line two', new_string: 'line TWO' })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toContain('line TWO')
    })

    it('replaces multi-line string', async () => {
      const r = await tool().execute({ file_path: 'a.txt', old_string: 'line one\nline TWO', new_string: 'line 1\nline 2' })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')
      expect(content).toContain('line 1')
      expect(content).toContain('line 2')
    })

    it('reports old_string not found', async () => {
      const r = await tool().execute({ file_path: 'a.txt', old_string: 'nonexistent', new_string: 'x' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('not found')
    })

    it('reports duplicate old_string', async () => {
      const r = await tool().execute({ file_path: 'dup.txt', old_string: 'abc', new_string: 'xyz' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('MULTIPLE times')
    })

    it('rejects missing file_path', async () => {
      const r = await tool().execute({ old_string: 'x', new_string: 'y' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('file_path is required')
    })

    it('rejects missing old_string', async () => {
      const r = await tool().execute({ file_path: 'x', new_string: 'y' })
      expect(r.success).toBe(false)
      expect(r.error).toContain('old_string is required')
    })

    it('reports file not found', async () => {
      const r = await tool().execute({ file_path: 'nonexistent.txt', old_string: 'x', new_string: 'y' })
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

  describe('create mode', () => {
    const createdDir = () => path.join(tmpDir, 'created-test')

    afterAll(() => {
      fs.rmSync(createdDir(), { recursive: true, force: true })
    })

    it('creates a new file with empty old_string', async () => {
      const r = await tool().execute({ file_path: 'created-test/new.ts', old_string: '', new_string: 'const x = 1\nexport { x }' })
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
      const r = await tool().execute({ file_path: 'created-test/new.ts', old_string: '', new_string: 'x' })
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
