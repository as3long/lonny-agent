import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createBatchEditTool } from '../batch_edit.js'
import { PatchApplier } from '../../diff/apply.js'
import { makeTempDir } from './helpers.js'

describe('batch_edit tool', () => {
  let editDir: string

  beforeAll(() => {
    editDir = makeTempDir()
    fs.writeFileSync(path.join(editDir, 'target.txt'), 'line1\nline2\nline3\nline4\nline5\n')
  })

  afterAll(() => {
    fs.rmSync(editDir, { recursive: true, force: true })
  })

  it('rejects missing patch_text', async () => {
    const tool = createBatchEditTool(new PatchApplier(), editDir, true)
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('patch_text is required')
  })

  it('applies update patch with read-then-edit', async () => {
    const app = new PatchApplier()
    app.markRead(path.resolve(editDir, 'target.txt'))
    const tool = createBatchEditTool(app, editDir, true)
    const patch = `@ target.txt\n@@ -2,3 +2,3 @@\n line1\n-line2\n-line3\n+changed2\n+changed3\n line4`
    const result = await tool.execute({ patch_text: patch })
    expect(result.success).toBe(true)
    expect(result.output).toContain('UPDATE')
    const content = fs.readFileSync(path.join(editDir, 'target.txt'), 'utf-8')
    expect(content).toContain('changed2')
    expect(content).toContain('changed3')
  })

  it('creates a new file', async () => {
    const app = new PatchApplier()
    const tool = createBatchEditTool(app, editDir, true)
    const result = await tool.execute({ patch_text: '@ newfile.txt:create\n+hello new file\n+second line\n' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('CREATE')
    const content = fs.readFileSync(path.join(editDir, 'newfile.txt'), 'utf-8')
    expect(content).toBe('hello new file\nsecond line\n')
    fs.unlinkSync(path.join(editDir, 'newfile.txt'))
  })

  it('deletes file after reading it', async () => {
    const delPath = path.join(editDir, 'todelete.txt')
    fs.writeFileSync(delPath, 'will be deleted')
    const app = new PatchApplier()
    app.markRead(delPath)
    const tool = createBatchEditTool(app, editDir, true)
    const result = await tool.execute({ patch_text: '@ todelete.txt:delete\n' })
    expect(result.success).toBe(true)
    expect(fs.existsSync(delPath)).toBe(false)
  })

  it('fails on update without prior read', async () => {
    const app = new PatchApplier()
    const tool = createBatchEditTool(app, editDir, true)
    const result = await tool.execute({ patch_text: '@ target.txt\n@@ -1,1 +1,1 @@\n line1\n-changed\n+revert\n' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('was not read')
  })

  it('fails when context lines do not match', async () => {
    const filePath = path.resolve(editDir, 'target.txt')
    const original = fs.readFileSync(filePath, 'utf-8')
    const app = new PatchApplier()
    app.markRead(filePath)
    const tool = createBatchEditTool(app, editDir, true)
    const patch = `@ target.txt\n@@ -99,1 +99,1 @@\n __nonexistent_line_xyz__\n-nope\n+never\n`
    const result = await tool.execute({ patch_text: patch })
    expect(result.success).toBe(false)
    expect(result.error).toContain('context lines did not match')
    expect(result.error).toContain('Received patch_text')
    expect(result.error).toContain('__nonexistent_line_xyz__')
    fs.writeFileSync(filePath, original)
  })

  it('rejects malformed patch_text', async () => {
    const tool = createBatchEditTool(new PatchApplier(), editDir, true)
    const result = await tool.execute({ patch_text: '@ @@ garbage @@' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No changes found in patch')
  })

  it('hints about unified diff headers', async () => {
    const tool = createBatchEditTool(new PatchApplier(), editDir, true)
    const result = await tool.execute({ patch_text: 'diff --git a/foo b/foo\n--- a/foo\n+++ b/foo\n@@ -1 +1 @@\n-x\n+y\n' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('unified diff headers')
  })

  it('hints about literal "\\n" escapes', async () => {
    const tool = createBatchEditTool(new PatchApplier(), editDir, true)
    const result = await tool.execute({ patch_text: '+console.log("hi")\\n+more' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('escape newlines')
  })
})
