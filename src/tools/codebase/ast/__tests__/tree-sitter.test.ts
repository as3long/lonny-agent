import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../adapter.js'
import { createTreeSitterAdapter } from '../tree-sitter-adapter.js'

const adapter = createTreeSitterAdapter()

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('file.ts')).toBe('typescript')
    expect(detectLanguage('file.tsx')).toBe('typescript')
    expect(detectLanguage('file.mts')).toBe('typescript')
    expect(detectLanguage('file.cts')).toBe('typescript')
  })

  it('detects JavaScript', () => {
    expect(detectLanguage('file.js')).toBe('javascript')
    expect(detectLanguage('file.jsx')).toBe('javascript')
    expect(detectLanguage('file.mjs')).toBe('javascript')
    expect(detectLanguage('file.cjs')).toBe('javascript')
  })

  it('detects Python', () => {
    expect(detectLanguage('file.py')).toBe('python')
  })

  it('throws for unsupported files', () => {
    expect(() => detectLanguage('file.rs')).toThrow('Unsupported file type')
  })
})

describe('TreeSitterAdapter - TypeScript/JavaScript', () => {
  it('parses a simple TypeScript function', async () => {
    const source = `
function greet(name: string): string {
  return "Hello, " + name
}
`
    const module = await adapter.parse(source, 'test.ts')
    expect(module.type).toBe('Module')
    expect(module.language).toBe('typescript')
    const funcs = adapter.findFunctions(module)
    expect(funcs).toHaveLength(1)
    expect(funcs[0].name).toBe('greet')
    expect(funcs[0].parameters).toHaveLength(1)
    expect(funcs[0].parameters[0].name).toBe('name')
    expect(funcs[0].isAsync).toBe(false)
    expect(funcs[0].isGenerator).toBe(false)
    expect(funcs[0].startLine).toBe(2)
  })

  it('parses arrow functions', async () => {
    const source = `const add = (a: number, b: number): number => a + b`
    const module = await adapter.parse(source, 'test.ts')
    const funcs = adapter.findFunctions(module)
    expect(funcs).toHaveLength(1)
    expect(funcs[0].name).toBeNull()
    expect(funcs[0].parameters).toHaveLength(2)
  })

  it('parses async functions', async () => {
    const source = `
async function fetchData(url: string): Promise<unknown> {
  const response = await fetch(url)
  return response.json()
}
`
    const module = await adapter.parse(source, 'test.ts')
    const funcs = adapter.findFunctions(module)
    expect(funcs).toHaveLength(1)
    expect(funcs[0].isAsync).toBe(true)
    expect(funcs[0].name).toBe('fetchData')
  })

  it('parses classes with methods', async () => {
    const source = `class Animal {
  name: string
  constructor(name: string) {
    this.name = name
  }
  speak(): string {
    return this.name
  }
}`
    const module = await adapter.parse(source, 'test.ts')
    const classes = adapter.findClasses(module)
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Animal')
    expect(classes[0].members).toHaveLength(3)
    expect(classes[0].members[0].type).toBe('Property')
    expect(classes[0].members[0].name).toBe('name')
    expect(classes[0].members[1].kind).toBe('constructor')
    expect(classes[0].members[2].kind).toBe('method')
  })

  it('parses imports', async () => {
    const source = `
import { foo, bar as baz } from './utils'
import fs from 'fs'
import * as path from 'path'
`
    const module = await adapter.parse(source, 'test.ts')
    expect(module.imports).toHaveLength(3)
    expect(module.imports[0].source).toBe("'./utils'")
    expect(module.imports[0].specifiers).toHaveLength(2)
    expect(module.imports[0].specifiers[0].localName).toBe('foo')
    expect(module.imports[0].specifiers[1].localName).toBe('baz')
    expect(module.imports[0].specifiers[1].importedName).toBe('bar')
    expect(module.imports[1].specifiers[0].localName).toBe('fs')
    expect(module.imports[2].specifiers[0].localName).toBe('path')
  })

  it('parses exports', async () => {
    const source = `export const value = 42`
    const module = await adapter.parse(source, 'test.ts')
    expect(module.exports).toContain('value')
  })

  it('parses variables', async () => {
    const source = `
const a = 1
let b = 2
var c = 3
`
    const module = await adapter.parse(source, 'test.ts')
    const vars = adapter.findVariables(module)
    expect(vars).toHaveLength(3)
    expect(vars[0].name).toBe('a')
    expect(vars[0].kind).toBe('const')
  })

  it('gets structure overview', async () => {
    const source = `
import { z } from 'zod'

function add(a: number, b: number): number {
  return a + b
}

class Calculator {
  result = 0
  add(n: number): number {
    return this.result + n
  }
}

const PI = 3.14
`
    const module = await adapter.parse(source, 'test.ts')
    const structure = adapter.getStructure(module)
    expect(structure.imports).toHaveLength(1)
    expect(structure.imports[0].source).toBe("'zod'")
    expect(structure.imports[0].names).toContain('z')
    expect(structure.functions).toHaveLength(1)
    expect(structure.functions[0].name).toBe('add')
    expect(structure.classes).toHaveLength(1)
    expect(structure.classes[0].name).toBe('Calculator')
    expect(structure.classes[0].methods).toContain('add')
    expect(structure.variables).toHaveLength(1)
    expect(structure.variables[0].name).toBe('PI')
  })
})

describe('TreeSitterAdapter - Python', () => {
  it('parses a Python function', async () => {
    const source = `
def greet(name: str) -> str:
    return f"Hello, {name}"
`
    const module = await adapter.parse(source, 'test.py')
    expect(module.language).toBe('python')
    const funcs = adapter.findFunctions(module)
    expect(funcs).toHaveLength(1)
    expect(funcs[0].name).toBe('greet')
    expect(funcs[0].startLine).toBe(2)
  })

  it('parses Python class with methods', async () => {
    const source = `
class Animal:
    def __init__(self, name: str):
        self.name = name

    def speak(self) -> str:
        return self.name
`
    const module = await adapter.parse(source, 'test.py')
    const classes = adapter.findClasses(module)
    expect(classes).toHaveLength(1)
    expect(classes[0].name).toBe('Animal')
    expect(classes[0].members).toHaveLength(2)
  })

  it('parses Python imports', async () => {
    const source = `
import os, sys
from pathlib import Path
import numpy as np
`
    const module = await adapter.parse(source, 'test.py')
    expect(module.imports).toHaveLength(3)
    expect(module.imports[2].specifiers[0].localName).toBe('np')
    expect(module.imports[2].specifiers[0].importedName).toBe('np')
  })

  it('parses Python async functions', async () => {
    const source = `
async def fetch_data(url: str):
    return await some_async_fn(url)
`
    const module = await adapter.parse(source, 'test.py')
    const funcs = adapter.findFunctions(module)
    expect(funcs).toHaveLength(1)
    expect(funcs[0].isAsync).toBe(true)
  })
})

describe('TreeSitterAdapter - editing', () => {
  it('replaces a node at a given line', async () => {
    const source = `function oldFunc() {
  return 1
}

function other() {
  return 2
}`
    const result = await adapter.replaceNode(
      source,
      'test.ts',
      1,
      'function newFunc() {\n  return 42\n}',
    )
    expect(result.success).toBe(true)
    expect(result.source).toContain('newFunc')
    expect(result.source).toContain('other')
    expect(result.source).not.toContain('oldFunc')
  })

  it('errors on non-existent line', async () => {
    const source = `const x = 1`
    const result = await adapter.replaceNode(source, 'test.ts', 100, 'should not appear')
    expect(result.success).toBe(false)
    expect(result.error).toContain('No node found at line 100')
  })

  it('applies multiple byte-offset edits', async () => {
    const source = `function a() { return 1 }
function b() { return 2 }`
    const result = await adapter.applyEdits(source, 'test.ts', [
      { type: 'replace', startOffset: 0, endOffset: 26, text: 'function a() { return 10 }' },
    ])
    expect(result.success).toBe(true)
    expect(result.source).toContain('return 10')
    expect(result.source).toContain('function b')
  })
})

describe('TreeSitterAdapter - error handling', () => {
  it('handles empty source', async () => {
    const module = await adapter.parse('', 'test.ts')
    expect(module.body).toHaveLength(0)
    expect(module.imports).toHaveLength(0)
  })

  it('handles source with only comments', async () => {
    const source = `// this is a comment
/* another comment */`
    const module = await adapter.parse(source, 'test.ts')
    expect(module.body).toHaveLength(0)
  })

  it('handles syntax errors gracefully', async () => {
    const source = `function ( {`
    const module = await adapter.parse(source, 'test.ts')
    expect(module).toBeDefined()
  })

  it('returns empty structure for unsupported language fallback', async () => {
    const result = await adapter.replaceNode('x = 1', 'unknown.xyz', 1, 'y = 2')
    expect(result.success).toBe(false)
  })
})
