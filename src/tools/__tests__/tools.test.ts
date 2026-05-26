import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execSync } from 'node:child_process'
import { createReadTool } from '../read.js'
import { globTool } from '../glob.js'
import { createGrepTool } from '../grep.js'
import { createLsTool } from '../ls.js'
import { bashTool } from '../bash.js'
import { createBatchEditTool } from '../batch_edit.js'
import { ToolRegistry } from '../registry.js'
import { PatchApplier } from '../../diff/apply.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-test-'))
}

describe('read tool', () => {
  let tmpDir: string
  let applier: PatchApplier

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\nfoo bar\nbaz qux\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'line1\nline2\nline3\n')
    fs.mkdirSync(path.join(tmpDir, 'empty'))
    applier = new PatchApplier()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = (): ReturnType<typeof createReadTool> => createReadTool(applier, tmpDir)

  it('reads existing files', async () => {
    const result = await tool().execute({ paths: ['a.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('=== a.txt ===')
    expect(result.output).toContain('hello world')
  })

  it('reads multiple files', async () => {
    const result = await tool().execute({ paths: ['a.txt', 'b.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('=== a.txt ===')
    expect(result.output).toContain('=== b.txt ===')
  })

  it('returns error for non-existent file', async () => {
    const result = await tool().execute({ paths: ['nonexistent.txt'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('(error:')
  })

  it('returns error for directory path', async () => {
    const result = await tool().execute({ paths: ['empty'] })
    expect(result.success).toBe(true)
    expect(result.output).toContain('not a file')
  })

  it('rejects empty paths', async () => {
    const result = await tool().execute({ paths: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })

  it('rejects missing paths', async () => {
    const result = await tool().execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })

  it('rejects non-array paths', async () => {
    const result = await tool().execute({ paths: 'not-an-array' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('paths must be a non-empty array')
  })
})

describe('glob tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello world\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'line1\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(tmpDir, 'sub', 'd.ts'), 'export const y = 2\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('finds files by pattern', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '*.txt') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
    expect(result.output).toContain('b.txt')
  })

  it('finds files in subdirectories', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '**', '*.ts') })
    expect(result.success).toBe(true)
    expect(result.output).toContain('c.ts')
    expect(result.output).toContain('d.ts')
  })

  it('returns no matches for unmatched pattern', async () => {
    const result = await globTool.execute({ pattern: path.join(tmpDir, '*.xyz') })
    expect(result.success).toBe(true)
    expect(result.output).toBe('No files matched the pattern.')
  })

  it('rejects missing pattern', async () => {
    const result = await globTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('pattern is required')
  })
})

describe('grep tool', () => {
  let hasRg: boolean
  beforeAll(() => {
    try {
      execSync('rg --version', { stdio: 'pipe' })
      hasRg = true
    } catch {
      hasRg = false
    }
  })

  const tool = createGrepTool(process.cwd())

  it('finds matching lines', async () => {
    if (!hasRg) return
    const result = await tool.execute({ pattern: 'describe' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('describe')
  })

  it('returns no matches for missing pattern', async () => {
    if (!hasRg) return
    const result = await tool.execute({ pattern: 'zzz_nonexistent_zzz' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('No matches found.')
  })

  it('rejects missing pattern argument', async () => {
    const result = await tool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('pattern is required')
  })

  it('reports rg not installed gracefully', async () => {
    if (hasRg) return
    const result = await tool.execute({ pattern: 'hello' })
    expect(result.success).toBe(false)
  })
})

describe('ls tool', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n')
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world\n')
    fs.mkdirSync(path.join(tmpDir, 'sub'))
    fs.writeFileSync(path.join(tmpDir, 'sub', 'c.ts'), 'x\n')
    fs.writeFileSync(path.join(tmpDir, 'sub', 'd.ts'), 'y\n')
    fs.mkdirSync(path.join(tmpDir, 'empty'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createLsTool(tmpDir)

  it('lists directory contents', async () => {
    const result = await tool().execute({})
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
    expect(result.output).toContain('b.txt')
    expect(result.output).toContain('sub/')
    expect(result.output).toContain('empty/')
  })

  it('lists subdirectory', async () => {
    const result = await tool().execute({ path: 'sub' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('c.ts')
    expect(result.output).toContain('d.ts')
  })

  it('returns error for invalid path', async () => {
    const result = await tool().execute({ path: '/nonexistent_path_xyz' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to list directory')
  })

  it('lists empty directory', async () => {
    const result = await tool().execute({ path: 'empty' })
    expect(result.success).toBe(true)
    expect(result.output).toBe('')
  })
})

describe('bash tool', () => {
  it('executes a command successfully', async () => {
    const result = await bashTool.execute({ command: 'echo hello' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('hello')
  })

  it('rejects missing command', async () => {
    const result = await bashTool.execute({})
    expect(result.success).toBe(false)
    expect(result.error).toContain('command is required')
  })

  it('returns error for invalid command', async () => {
    const result = await bashTool.execute({ command: 'some_nonexistent_command_xyz' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Command failed')
  })

  it('accepts custom timeout', async () => {
    const result = await bashTool.execute({ command: 'echo timed', timeout: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('timed')
  })

  it('handles command with description', async () => {
    const result = await bashTool.execute({ command: 'echo desc', description: 'test command' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('desc')
  })
})

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
    fs.writeFileSync(filePath, original)
  })

  it('rejects malformed patch_text', async () => {
    const tool = createBatchEditTool(new PatchApplier(), editDir, true)
    const result = await tool.execute({ patch_text: '@ @@ garbage @@' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('No changes found in patch')
  })
})

describe('ToolRegistry', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello\n')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('registers tools in code mode', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).toContain('grep')
    expect(names).toContain('ls')
    expect(names).toContain('bash')
    expect(names).toContain('batch_edit')
  })

  it('excludes batch_edit in plan mode', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'plan' })
    const defs = reg.getDefinitions()
    const names = defs.map(d => d.name)
    expect(names).toContain('read')
    expect(names).toContain('glob')
    expect(names).not.toContain('batch_edit')
  })

  it('setMode adds batch_edit when switching to code', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'plan' })
    reg.setMode('code')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).toContain('batch_edit')
  })

  it('setMode removes batch_edit when switching to plan', () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    reg.setMode('plan')
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).not.toContain('batch_edit')
  })

  it('dispatches to correct tool', async () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const result = await reg.dispatch({ id: '1', name: 'ls', input: {} })
    expect(result.success).toBe(true)
    expect(result.output).toContain('a.txt')
  })

  it('returns error for unknown tool', async () => {
    const reg = new ToolRegistry({ cwd: tmpDir, autoApprove: true, applier: new PatchApplier(), mode: 'code' })
    const result = await reg.dispatch({ id: '1', name: 'nonexistent', input: {} })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unknown tool')
  })
})