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
})
