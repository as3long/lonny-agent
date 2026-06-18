import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileReadTracker } from '../../../../diff/apply.js'
import { makeTempDir } from '../../../__tests__/helpers.js'
import { ToolRegistry } from '../../../registry.js'

describe('AST tools registration', () => {
  let tmpDir: string
  let tsFile: string
  let pyFile: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    tsFile = path.join(tmpDir, 'test.ts')
    pyFile = path.join(tmpDir, 'test.py')
    fs.writeFileSync(
      tsFile,
      `import { z } from 'zod'

function add(a: number, b: number): number {
  return a + b
}

class Calc {
  value = 0
  add(n: number): number {
    return this.value + n
  }
}
`,
    )
    fs.writeFileSync(
      pyFile,
      `import os

def greet(name: str) -> str:
    return f"Hello, {name}"

class Counter:
    def __init__(self):
        self.count = 0
`,
    )
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('registers ast_query and ast_edit in code mode', () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const names = reg.getDefinitions().map(d => d.name)
    expect(names).toContain('ast_query')
    expect(names).toContain('ast_edit')
  })

  it('ast_query works via gateway', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: tsFile, query: 'structure' },
      },
    })
    expect(result.success).toBe(true)
    const structure = JSON.parse(result.output)
    expect(structure.functions).toHaveLength(1)
    expect(structure.functions[0].name).toBe('add')
    expect(structure.classes).toHaveLength(1)
    expect(structure.classes[0].name).toBe('Calc')
  })

  it('ast_query functions on python file', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: pyFile, query: 'functions' },
      },
    })
    expect(result.success).toBe(true)
    const functions = JSON.parse(result.output)
    expect(functions).toHaveLength(1)
    expect(functions[0].name).toBe('greet')
  })

  it('ast_query returns error for missing file', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: '/nonexistent/file.ts', query: 'structure' },
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('ast_query returns error for invalid query type', async () => {
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: tsFile, query: 'invalid' },
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid query')
  })

  it('ast_edit replace-node works via gateway', async () => {
    const tmpFile = path.join(tmpDir, 'edit-test.ts')
    fs.writeFileSync(tmpFile, `function oldFunc() {\n  return 1\n}\n`)

    const applier = new FileReadTracker()
    applier.markRead(tmpFile)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: tmpFile,
          editType: 'replace-node',
          targetLine: 1,
          newCode: 'function newFunc() {\n  return 42\n}',
        },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Replaced node')
    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toContain('newFunc')
    expect(content).not.toContain('oldFunc')
  })

  it('ast_edit insert-import works via gateway', async () => {
    const tmpFile = path.join(tmpDir, 'import-test.ts')
    fs.writeFileSync(tmpFile, 'const x = 1\n')

    const applier = new FileReadTracker()
    applier.markRead(tmpFile)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: tmpFile,
          editType: 'insert-import',
          importSource: './utils',
          importName: 'foo',
        },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Inserted import')
    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toContain("import foo from './utils'")
  })

  it('ast_edit rename works via gateway', async () => {
    const tmpFile = path.join(tmpDir, 'rename-test.ts')
    fs.writeFileSync(tmpFile, 'function oldName() { return 1 }\n')

    const applier = new FileReadTracker()
    applier.markRead(tmpFile)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: tmpFile,
          editType: 'rename',
          oldName: 'oldName',
          newName: 'newName',
        },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Renamed')
    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toContain('newName')
    expect(content).not.toContain('oldName')
  })

  it('ast_query works with Python decorated functions', async () => {
    const decPyFile = path.join(tmpDir, 'decorated.py')
    fs.writeFileSync(
      decPyFile,
      `import functools

@functools.lru_cache
def cached_func(n: int) -> int:
    return n * 2

@some_decorator
class DecoratedClass:
    pass
`,
    )
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: decPyFile, query: 'functions' },
      },
    })
    expect(result.success).toBe(true)
    const functions = JSON.parse(result.output)
    expect(functions).toHaveLength(1)
    expect(functions[0].name).toBe('cached_func')

    const clsResult = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: decPyFile, query: 'classes' },
      },
    })
    expect(clsResult.success).toBe(true)
    const classes = JSON.parse(clsResult.output)
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('DecoratedClass')
  })

  it('ast_edit batch edit multiple files', async () => {
    const file1 = path.join(tmpDir, 'batch-1.ts')
    const file2 = path.join(tmpDir, 'batch-2.ts')
    fs.writeFileSync(file1, 'function foo() { return 1 }\n')
    fs.writeFileSync(file2, 'function bar() { return 2 }\n')

    const applier = new FileReadTracker()
    applier.markRead(file1)
    applier.markRead(file2)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })

    // Edit file1: rename foo -> fooRenamed
    const r1 = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: { path: file1, editType: 'rename', oldName: 'foo', newName: 'fooRenamed' },
      },
    })
    expect(r1.success).toBe(true)
    expect(r1.output).toContain('Renamed')
    expect(fs.readFileSync(file1, 'utf-8')).toContain('fooRenamed')

    // Edit file2: replace-node on bar
    const r2 = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: file2,
          editType: 'replace-node',
          targetLine: 1,
          newCode: 'function barReplaced() {\n  return 42\n}',
        },
      },
    })
    expect(r2.success).toBe(true)
    expect(r2.output).toContain('Replaced node')
    const content2 = fs.readFileSync(file2, 'utf-8')
    expect(content2).toContain('barReplaced')
    expect(content2).not.toContain('function bar(')

    // Verify file1 unchanged by second edit
    expect(fs.readFileSync(file1, 'utf-8')).toContain('fooRenamed')
  })

  it('ast_query references via integration', async () => {
    const filePath = path.join(tmpDir, 'refs-test.ts')
    fs.writeFileSync(
      filePath,
      `function greet() { return "hello" }
function run() {
  const a = greet()
  const b = greet(1)
  return a + b
}
`,
    )
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: filePath, query: 'references', nameFilter: 'greet' },
      },
    })
    expect(result.success).toBe(true)
    const refs = JSON.parse(result.output)
    expect(refs).toHaveLength(2)
    expect(refs[0].name).toBe('greet')
    expect(refs[1].name).toBe('greet')
  })

  it('ast_query references requires nameFilter', async () => {
    const filePath = path.join(tmpDir, 'refs-test2.ts')
    fs.writeFileSync(filePath, `const x = foo()\n`)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier: new FileReadTracker(),
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_query',
        params: { path: filePath, query: 'references' },
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('nameFilter is required')
  })

  it('ast_edit insert-method works via gateway', async () => {
    const tmpFile = path.join(tmpDir, 'insert-method-test.ts')
    fs.writeFileSync(tmpFile, `class MyClass {\n  existing() { return 1 }\n}\n`)

    const applier = new FileReadTracker()
    applier.markRead(tmpFile)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: tmpFile,
          editType: 'insert-method',
          className: 'MyClass',
          methodCode: 'newMethod() { return 2 }',
        },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('Inserted method into class')
    const content = fs.readFileSync(tmpFile, 'utf-8')
    expect(content).toContain('newMethod()')
    expect(content).toContain('existing()')
  })

  it('ast_edit insert-method rejects missing className', async () => {
    const tmpFile = path.join(tmpDir, 'insert-method-test2.ts')
    fs.writeFileSync(tmpFile, `class A {}\n`)
    const applier = new FileReadTracker()
    applier.markRead(tmpFile)
    const reg = new ToolRegistry({
      cwd: tmpDir,
      autoApprove: true,
      applier,
      mode: 'code',
    })
    const result = await reg.dispatch({
      id: 'test',
      name: 'tool',
      input: {
        name: 'ast_edit',
        params: {
          path: tmpFile,
          editType: 'insert-method',
        },
      },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('className and methodCode are required')
  })
})
