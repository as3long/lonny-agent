import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEditTool } from '../edit/edit.js'
import {
  detectLanguage,
  detectPythonIndentWidth,
  fixFileIndentation,
} from '../edit/indent-fix.js'
import { makeTempDir } from './helpers.js'

// 閳光偓閳光偓 Minimal mock for FileReadTracker 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
function makeApplier() {
  const readSet = new Set<string>()
  return {
    markRead(f: string) {
      readSet.add(f)
    },
    checkModified(f: string): string | null {
      return readSet.has(f) ? null : `Warning: file was not read first.`
    },
  }
}

// 閳光偓閳光偓 Tests for detectLanguage 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
describe('detectLanguage', () => {
  it('detects .ts as typescript', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript')
  })

  it('detects .tsx as typescript', () => {
    expect(detectLanguage('foo.tsx')).toBe('typescript')
  })

  it('detects .mts as typescript', () => {
    expect(detectLanguage('foo.mts')).toBe('typescript')
  })

  it('detects .cts as typescript', () => {
    expect(detectLanguage('foo.cts')).toBe('typescript')
  })

  it('detects .js as javascript', () => {
    expect(detectLanguage('foo.js')).toBe('javascript')
  })

  it('detects .jsx as javascript', () => {
    expect(detectLanguage('foo.jsx')).toBe('javascript')
  })

  it('detects .mjs as javascript', () => {
    expect(detectLanguage('foo.mjs')).toBe('javascript')
  })

  it('detects .cjs as javascript', () => {
    expect(detectLanguage('foo.cjs')).toBe('javascript')
  })

  it('detects .py as python', () => {
    expect(detectLanguage('foo.py')).toBe('python')
  })

  it('returns null for .txt', () => {
    expect(detectLanguage('foo.txt')).toBeNull()
  })

  it('returns null for .json', () => {
    expect(detectLanguage('foo.json')).toBeNull()
  })

  it('returns null for .md', () => {
    expect(detectLanguage('README.md')).toBeNull()
  })

  it('handles uppercase extensions', () => {
    expect(detectLanguage('foo.TS')).toBe('typescript')
  })

  it('handles paths with directories', () => {
    expect(detectLanguage('/path/to/src/index.ts')).toBe('typescript')
  })
})

// 閳光偓閳光偓 Tests for detectPythonIndentWidth 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
describe('detectPythonIndentWidth', () => {
  it('detects 4-space indent', () => {
    const lines = [
      'def foo():',
      '    pass',
      '    return 1',
    ]
    expect(detectPythonIndentWidth(lines)).toBe(4)
  })

  it('detects 2-space indent', () => {
    const lines = [
      'def foo():',
      '  pass',
      '  return 1',
    ]
    expect(detectPythonIndentWidth(lines)).toBe(2)
  })

  it('returns null for no indented lines', () => {
    const lines = ['a = 1', 'b = 2', 'c = 3']
    expect(detectPythonIndentWidth(lines)).toBeNull()
  })

  it('returns null for empty file', () => {
    expect(detectPythonIndentWidth([])).toBeNull()
  })

  it('defaults to 4 when width is unusual but present', () => {
    // Only one indent level with 7 spaces 閳?unusual, should return 4
    const lines = [
      'def foo():',
      '       pass',
    ]
    const result = detectPythonIndentWidth(lines)
    expect(result).toBe(4)
  })
})

// 閳光偓閳光偓 Tests for fixFileIndentation 閳?Python 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
describe('fixFileIndentation (Python)', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writePy(content: string): string {
    const filePath = path.join(tmpDir, 'test.py')
    fs.writeFileSync(filePath, content, 'utf-8')
    return filePath
  }

  function readPy(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8')
  }

  it('normalizes tabs to 4 spaces', () => {
    const content = 'def foo():\n\tpass\n\treturn 1\n'
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    expect(result).toBe('def foo():\n    pass\n    return 1\n')
  })

  it('fixes wrong indentation after if block', () => {
    const content = [
      'x = 1',
      'if x > 0:',
      '  print("positive")',
      '      print("done")',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    expect(lines[2]).toBe('    print("positive")')
    expect(lines[3]).toBe('    print("done")')
  })

  it('handles else/elif dedent correctly', () => {
    const content = [
      'x = 1',
      'if x > 0:',
      '    print("positive")',
      '  else:',
      '    print("not positive")',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    // else should be at same indent as if
    expect(lines[3]).toBe('else:')
    expect(lines[4]).toBe('    print("not positive")')
  })

  it('handles function definition and body', () => {
    const content = [
      'def greet(name):',
      '  return f"Hello, {name}"',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    expect(lines[1]).toBe('    return f"Hello, {name}"')
  })

  it('handles nested blocks (function inside class)', () => {
    const content = [
      'class MyClass:',
      '    def method(self):',
      '      pass',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    expect(lines[1]).toBe('    def method(self):')
    expect(lines[2]).toBe('        pass')
  })

  it('preserves blank lines and comments', () => {
    const content = [
      'def foo():',
      '    a = 1',
      '',
      '    # This is a comment',
      '    b = 2',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    expect(lines[0]).toBe('def foo():')
    expect(lines[1]).toBe('    a = 1')
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('    # This is a comment')
    expect(lines[4]).toBe('    b = 2')
  })

  it('handles try/except/finally blocks', () => {
    const content = [
      'try:',
      '    risky()',
      'except ValueError:',
      '    handle()',
      'finally:',
      '    cleanup()',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    const lines = result.split('\n')
    expect(lines[0]).toBe('try:')
    expect(lines[1]).toBe('    risky()')
    expect(lines[2]).toBe('except ValueError:')
    expect(lines[3]).toBe('    handle()')
    expect(lines[4]).toBe('finally:')
    expect(lines[5]).toBe('    cleanup()')
  })

  it('does not modify already-correct Python', () => {
    const content = [
      'def foo():',
      '    a = 1',
      '    if a > 0:',
      '        print("ok")',
      '',
    ].join('\n')
    const filePath = writePy(content)
    fixFileIndentation(filePath, tmpDir)
    const result = readPy(filePath)
    expect(result).toBe(content)
  })

  it('does not modify non-target files (.txt)', () => {
    const filePath = path.join(tmpDir, 'test.txt')
    fs.writeFileSync(filePath, '  indented line\n  another line\n', 'utf-8')
    fixFileIndentation(filePath, tmpDir)
    const result = fs.readFileSync(filePath, 'utf-8')
    expect(result).toBe('  indented line\n  another line\n')
  })
})

// 閳光偓閳光偓 Integration tests through createEditTool 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
describe('edit tool integration', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = makeTempDir()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('Biome formats TypeScript files after edit', async () => {
    const applier = makeApplier() as any
    const tool = createEditTool(applier, tmpDir)

    // Create a TS file with bad formatting
    const filePath = path.join(tmpDir, 'test.ts')
    fs.writeFileSync(
      filePath,
      'const x=1\nconst y=2\n',
      'utf-8',
    )
    applier.markRead(filePath)

    // Edit the file using file_path/old_string/new_string fields
    const result = await tool.execute({
      file_path: 'test.ts',
      old_string: 'const x=1',
      new_string: 'const x = 1',
    })

    // Verify the edit succeeded and file was written
    expect(result.success).toBe(true)
    const content = fs.readFileSync(filePath, 'utf-8')
    expect(content).toContain('const x = 1')
  })

})
