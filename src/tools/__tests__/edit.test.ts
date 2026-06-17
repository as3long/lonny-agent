import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileReadTracker } from '../../diff/apply.js'
import { computeDiff } from '../edit/diff-compute.js'
import {
  escapeHtml,
  generateDiff,
  generateDiffWithContext,
  renderDiffTerminal,
} from '../edit/diff-render.js'
import { createEditTool } from '../edit/edit.js'
import { findAllLinesTolerant, normalizeLine } from '../edit/matcher.js'
import { parseMarkdownEdit } from '../edit/parser.js'
import { makeTempDir } from './helpers.js'

// ── Minimal mock for FileReadTracker ─────────────────────────────────────
function makeApplier(): FileReadTracker {
  const readSet = new Set<string>()
  return {
    markRead(f: string) {
      readSet.add(f)
    },
    checkModified(f: string): string | null {
      return readSet.has(f) ? null : `Warning: file was not read first.`
    },
  } as FileReadTracker
}

// ── Tests for pure functions ─────────────────────────────────────────────
describe('normalizeLine', () => {
  it('trims leading whitespace', () => {
    expect(normalizeLine('  hello')).toBe('hello')
  })

  it('trims trailing whitespace', () => {
    expect(normalizeLine('hello  ')).toBe('hello')
  })

  it('collapses internal space runs', () => {
    expect(normalizeLine('a    b')).toBe('a b')
  })

  it('collapses internal tab runs', () => {
    expect(normalizeLine('a\t\tb')).toBe('a b')
  })

  it('handles mixed spaces and tabs', () => {
    expect(normalizeLine('  a \t b  ')).toBe('a b')
  })

  it('reduces blank line with spaces to empty string', () => {
    expect(normalizeLine('   ')).toBe('')
  })

  it('preserves single spaces', () => {
    expect(normalizeLine('a b c')).toBe('a b c')
  })

  it('handles empty string', () => {
    expect(normalizeLine('')).toBe('')
  })
})

describe('findAllLinesTolerant', () => {
  it('finds exact match', () => {
    const result = findAllLinesTolerant('hello\nworld\nfoo\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    expect(result[0]!.index).toBe(0)
    expect(result[0]!.length).toBe('hello\nworld'.length)
  })

  it('finds match with trailing whitespace in content', () => {
    const result = findAllLinesTolerant('hello \nworld\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    // "hello \n" = 7 chars, "world" = 5 chars, total match = 12
    expect(result[0]!.length).toBe(12)
  })

  it('finds match with leading whitespace in content', () => {
    const result = findAllLinesTolerant('  hello\nworld\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    // "  hello\n" = 8 chars, "world" = 5, total = 13
    expect(result[0]!.length).toBe(13)
  })

  it('finds match with extra internal spaces', () => {
    const result = findAllLinesTolerant('foo  bar\nbaz\n', 'foo bar\nbaz')
    expect(result).toHaveLength(1)
  })

  it('returns empty array for empty oldString', () => {
    expect(findAllLinesTolerant('abc', '')).toEqual([])
  })

  it('returns empty when oldString longer than content', () => {
    expect(findAllLinesTolerant('a', 'a\nb\nc')).toEqual([])
  })

  it('returns empty when not found', () => {
    expect(findAllLinesTolerant('abc\ndef\n', 'xyz')).toEqual([])
  })

  it('finds multiple matches', () => {
    const result = findAllLinesTolerant('a\nb\na\nb\n', 'a\nb')
    expect(result).toHaveLength(2)
  })

  it('computes correct index for non-first match', () => {
    const result = findAllLinesTolerant('x\na\nb\n', 'a\nb')
    expect(result).toHaveLength(1)
    expect(result[0]!.index).toBe(2) // "x\n" = 2 chars
  })

  it('computes correct length matching original whitespace', () => {
    const result = findAllLinesTolerant('hello \nworld\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    const match = contentSlice('hello \nworld\n', result[0]!)
    expect(match).toBe('hello \nworld')
  })

  it('handles CRLF content - correct position computation', () => {
    const result = findAllLinesTolerant('hello\r\nworld\r\nfoo\r\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    expect(result[0]!.index).toBe(0)
    // 12 = 'hello\r' (6) + '\n' (1) + 'world' (5, trailing \r excluded)
    expect(result[0]!.length).toBe(12)
    const match = contentSlice('hello\r\nworld\r\nfoo\r\n', result[0]!)
    expect(match).toBe('hello\r\nworld')
  })

  it('handles mixed CRLF/LF content', () => {
    const result = findAllLinesTolerant('hello\r\nworld\nfoo\r\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    expect(result[0]!.index).toBe(0)
    expect(result[0]!.length).toBe(12)
    const match = contentSlice('hello\r\nworld\nfoo\r\n', result[0]!)
    expect(match).toBe('hello\r\nworld')
  })

  it('handles CRLF with whitespace normalization', () => {
    const result = findAllLinesTolerant('hello \r\nworld\r\n', 'hello\nworld')
    expect(result).toHaveLength(1)
    // 13 = 'hello \r' (7) + '\n' (1) + 'world' (5, trailing \r excluded)
    expect(result[0]!.length).toBe(13)
    const match = contentSlice('hello \r\nworld\r\n', result[0]!)
    expect(match).toBe('hello \r\nworld')
  })
})

function contentSlice(s: string, m: { index: number; length: number }): string {
  return s.slice(m.index, m.index + m.length)
}

describe('computeDiff', () => {
  it('returns empty array for empty strings', () => {
    expect(computeDiff('', '')).toEqual([])
  })

  it('returns delete lines when new is empty', () => {
    const result = computeDiff('a\nb', '')
    expect(result).toHaveLength(2)
    expect(result.every(l => l.type === 'delete')).toBe(true)
  })

  it('returns insert lines when old is empty', () => {
    const result = computeDiff('', 'a\nb')
    expect(result).toHaveLength(2)
    expect(result.every(l => l.type === 'insert')).toBe(true)
  })

  it('returns equal lines for unchanged content', () => {
    const result = computeDiff('hello\nworld', 'hello\nworld')
    expect(result).toHaveLength(2)
    expect(result.every(l => l.type === 'equal')).toBe(true)
  })

  it('produces mixed diff for changed content', () => {
    const result = computeDiff('hello\nworld', 'hi\nworld')
    // hello→hi should be delete+insert, world should be equal
    expect(result).toHaveLength(3)
    expect(result[0]!.type).toBe('delete')
    expect(result[0]!.content).toBe('hello')
    expect(result[1]!.type).toBe('insert')
    expect(result[1]!.content).toBe('hi')
    expect(result[2]!.type).toBe('equal')
    expect(result[2]!.content).toBe('world')
  })
})

describe('renderDiffTerminal', () => {
  it('returns empty string for empty input', () => {
    expect(renderDiffTerminal([])).toBe('')
  })

  it('renders delete lines in red with - prefix', () => {
    const lines = computeDiff('old', '')
    const output = renderDiffTerminal(lines)
    expect(output).toContain('\x1b[38;2;255;80;80m')
    expect(output).toContain('- 1  old')
    expect(output).toContain('\x1b[0m')
  })

  it('renders insert lines in green with + prefix', () => {
    const lines = computeDiff('', 'new')
    const output = renderDiffTerminal(lines)
    expect(output).toContain('\x1b[38;2;0;200;100m')
    expect(output).toContain('+ 1  new')
  })

  it('renders equal lines in dim with space prefix', () => {
    const lines = computeDiff('same', 'same')
    const output = renderDiffTerminal(lines)
    expect(output).toContain('\x1b[38;2;100;100;100m')
    expect(output).toContain('  same')
    expect(output).toContain('\x1b[0m')
  })
})

describe('generateDiff', () => {
  it('returns terminal-colored unified diff with line numbers', () => {
    const output = generateDiff('old', 'new')
    expect(output).toContain('\x1b[38;2;255;80;80m')
    expect(output).toContain('- 1  old')
    expect(output).toContain('\x1b[38;2;0;200;100m')
    expect(output).toContain('+ 1  new')
    expect(output).toContain('1')
  })

  it('returns terminal-colored unified diff with custom start line number', () => {
    const output = generateDiff('old', 'new', 10)
    expect(output).toContain('- 10  old')
    expect(output).toContain('+ 10  new')
  })
})

describe('generateDiffWithContext', () => {
  it('returns context line before match', () => {
    const output = generateDiffWithContext('keep\nreplace\nkeep', 'replace', 'REPLACE', 5, 7)
    expect(output).toContain('keep')
    expect(output).toContain('REPLACE')
  })

  it('returns no context before when match starts at first line', () => {
    const output = generateDiffWithContext('line1\nline2', 'line1', 'LINE1', 0, 5)
    expect(output).toContain('LINE1')
    const dimCount = (output.match(/\x1b\[38;2;100;100;100m/g) || []).length
    expect(dimCount).toBe(1)
  })

  it('returns no context after when match ends at last line', () => {
    const output = generateDiffWithContext('line1\nline2', 'line2', 'LINE2', 6, 5)
    expect(output).toContain('LINE2')
    const dimCount = (output.match(/\x1b\[38;2;100;100;100m/g) || []).length
    expect(dimCount).toBe(1)
  })

  it('handles matchIndex at exact end of content (append behavior)', () => {
    const output = generateDiffWithContext('line1\nline2', '', 'appended', 11, 0)
    expect(output).toContain('appended')
    // Should show line 2 context (the last line)
    expect(output).toContain('line2')
  })

  it('handles match spanning only the last line with no trailing newline', () => {
    const output = generateDiffWithContext('first\nlast', 'last', 'LAST', 6, 4)
    expect(output).toContain('LAST')
    expect(output).toContain('first')
    // No context after since match is on the last line
    const dimCount = (output.match(/\x1b\[38;2;100;100;100m/g) || []).length
    expect(dimCount).toBe(1)
  })

  it('handles fullContent with no trailing newline', () => {
    const output = generateDiffWithContext('line1\nline2\nline3', 'line2', 'LINE2', 6, 5)
    expect(output).toContain('LINE2')
    expect(output).toContain('line1')
    expect(output).toContain('line3')
  })

  it('handles match on single-line content with no trailing newline', () => {
    const output = generateDiffWithContext('onlyline', 'onlyline', 'REPLACED', 0, 8)
    expect(output).toContain('REPLACED')
    // No context dim lines, only the diff
    const dimCount = (output.match(/\x1b\[38;2;100;100;100m/g) || []).length
    expect(dimCount).toBe(0)
  })
})

describe('escapeHtml', () => {
  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b')
  })

  it('escapes less-than', () => {
    expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;')
  })

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('handles string with no special chars', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })
})

describe('parseMarkdownEdit', () => {
  it('parses single edit block', () => {
    const input = '```edit\nfile: src/test.ts\nold: |\n  hello\nnew: |\n  world\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('src/test.ts')
    // Pipe format preserves leading whitespace
    expect(edits[0]!.old_string).toBe('  hello')
    expect(edits[0]!.new_string).toBe('  world')
  })

  it('parses create file (empty old)', () => {
    const input = '```edit\nfile: src/new.ts\nold:\nnew: |\n  const x = 1\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('src/new.ts')
    expect(edits[0]!.old_string).toBe('')
    // Pipe format preserves leading whitespace
    expect(edits[0]!.new_string).toBe('  const x = 1')
  })

  it('parses create file with pipe (old: | empty content)', () => {
    const input = [
      '```edit',
      'file: src/new-pipe.ts',
      'old: |',
      'new: |',
      '  const x = 1',
      '```',
    ].join('\n')
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('src/new-pipe.ts')
    expect(edits[0]!.old_string).toBe('')
    // Pipe format preserves leading whitespace
    expect(edits[0]!.new_string).toBe('  const x = 1')
  })

  it('parses multiple edit blocks', () => {
    const input = [
      '```edit',
      'file: a.ts',
      'old: |',
      '  foo',
      'new: |',
      '  bar',
      '```',
      '```edit',
      'file: b.ts',
      'old: |',
      '  baz',
      'new: |',
      '  qux',
      '```',
    ].join('\n')
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(2)
    expect(edits[0]!.file_path).toBe('a.ts')
    // Pipe format preserves leading whitespace
    expect(edits[0]!.old_string).toBe('  foo')
    expect(edits[0]!.new_string).toBe('  bar')
    expect(edits[1]!.file_path).toBe('b.ts')
    expect(edits[1]!.old_string).toBe('  baz')
    expect(edits[1]!.new_string).toBe('  qux')
  })

  it('returns empty array when no edit blocks found', () => {
    expect(parseMarkdownEdit('no code blocks here')).toEqual([])
  })

  it('returns empty array when block has no file path', () => {
    const input = '```edit\nold: |\n  a\nnew: |\n  b\n```'
    expect(parseMarkdownEdit(input)).toEqual([])
  })

  it('parses edit block without pipe (single line)', () => {
    const input = '```edit\nfile: a.ts\nold: hello\nnew: world\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    // Non-pipe format: "old: hello" �?content after "old: " includes the leading space
    expect(edits[0]!.old_string).toBe(' hello')
    expect(edits[0]!.new_string).toBe(' world')
  })

  it('parses old with pipe-newline format', () => {
    const input = '```edit\nfile: a.ts\nold: |\n  multi\n  line\nnew: |\n  replaced\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    // Pipe format preserves leading whitespace (only strips the first \n)
    expect(edits[0]!.old_string).toBe('  multi\n  line')
    expect(edits[0]!.new_string).toBe('  replaced')
  })

  it('handles extra whitespace after ```edit', () => {
    const input = '```edit  \nfile: a.ts\nold: |\n  x\nnew: |\n  y\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
  })

  it('ignores non-edit code blocks', () => {
    const input = '```typescript\nconst x = 1\n```'
    expect(parseMarkdownEdit(input)).toEqual([])
  })

  it('handles mixed content with edit blocks', () => {
    const input = [
      'some text before',
      '',
      '```edit',
      'file: a.ts',
      'old: |',
      '  hello',
      'new: |',
      '  hi',
      '```',
      'some text after',
    ].join('\n')
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
  })

  it('handles early-``` closing (new: outside the block)', () => {
    // Model may close ``` before new: �?common mistake
    const input = [
      '```edit',
      'file: a.ts',
      'old: |',
      '  hello',
      '```',
      'new: |',
      '  world',
      '```',
    ].join('\n')
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.old_string).toBe('  hello')
    expect(edits[0]!.new_string).toBe('  world')
  })

  it('handles raw file:/old:/new: without ``` markers', () => {
    // Model outputs edit without ```edit / ``` wrappers
    const input = 'file: a.ts\nold: |\n  hello\nnew: |\n  world\n'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.old_string).toBe('  hello')
    expect(edits[0]!.new_string).toBe('  world')
  })

  it('handles edit block without any ``` markers (raw file:/old:/new: content)', () => {
    const input = 'file: a.ts\nold: |\n  hello\nnew: |\n  world\n'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.old_string).toBe('  hello')
    expect(edits[0]!.new_string).toBe('  world')
  })

  it('handles old:| then new: (no pipe on new)', () => {
    const input = '```edit\nfile: a.ts\nold: |\n  hello\nnew:\n  world\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.new_string).toBe('  world')
  })

  it('handles |2 pipe-with-digit syntax', () => {
    const input = '```edit\nfile: a.ts\nold: |2\n  hello\n  world\nnew: |1\n  hi\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.old_string).toBe('  hello\n  world')
    expect(edits[0]!.new_string).toBe('  hi')
  })

  it('handles backticks inside edit content', () => {
    const input = '```edit\nfile: a.ts\nold: |\n  some `code` here\nnew: |\n  replaced `code`\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.file_path).toBe('a.ts')
    expect(edits[0]!.old_string).toBe('  some `code` here')
    expect(edits[0]!.new_string).toBe('  replaced `code`')
  })

  it('handles old_string with trailing whitespace line', () => {
    const input = '```edit\nfile: a.ts\nold: |\n  hello\n  \nnew: |\n  hi\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.old_string).toBe('  hello\n  ')
  })

  it('handles new_string with empty content (deletion)', () => {
    const input = '```edit\nfile: a.ts\nold: |\n  remove me\nnew:\n```'
    const edits = parseMarkdownEdit(input)
    expect(edits).toHaveLength(1)
    expect(edits[0]!.old_string).toBe('  remove me')
    expect(edits[0]!.new_string).toBe('')
  })
})

// ── Markdown format integration tests ────────────────────────────────────
describe('edit tool �?markdown format', () => {
  let tmpDir: string
  let applier: FileReadTracker

  beforeAll(() => {
    tmpDir = makeTempDir()
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'line one\nline two\nline three\n')
    applier = makeApplier()
    applier.markRead(path.join(tmpDir, 'a.txt'))
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  it('replaces exact string via markdown format', async () => {
    const input = '```edit\nfile: a.txt\nold: |\n  line two\nnew: |\n  line TWO\n```'
    const r = await tool().execute({ content: input })
    expect(r.success).toBe(true)
    expect(fs.readFileSync(path.join(tmpDir, 'a.txt'), 'utf8')).toContain('line TWO')
  })

  it('replaces multi-line via markdown format', async () => {
    // Use a fresh file to avoid cross-test contamination
    const file = path.join(tmpDir, 'multi-md.txt')
    fs.writeFileSync(file, 'line one\nline two\nline three\n')
    applier.markRead(file)

    const input = [
      '```edit',
      'file: multi-md.txt',
      'old: |',
      '  line one',
      '  line two',
      'new: |',
      '  line 1',
      '  line 2',
      '```',
    ].join('\n')
    const r = await tool().execute({ content: input })
    expect(r.success).toBe(true)
    // Pipe format preserves leading whitespace from the block
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('  line 1')
    expect(content).toContain('  line 2')
  })

  it('creates file via markdown format', async () => {
    const input = '```edit\nfile: markdown-new.txt\nold:\nnew: |\n  created via markdown\n```'
    const r = await tool().execute({ content: input })
    expect(r.success).toBe(true)
    // Pipe format preserves leading whitespace from the block
    expect(fs.readFileSync(path.join(tmpDir, 'markdown-new.txt'), 'utf8')).toBe(
      '  created via markdown',
    )
  })

  it('reports parse error for malformed markdown', async () => {
    const r = await tool().execute({ content: 'not a valid edit block' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('Failed to parse')
  })

  it('applies multiple markdown blocks', async () => {
    fs.writeFileSync(path.join(tmpDir, 'multi-a.txt'), 'foo\nbar\n')
    fs.writeFileSync(path.join(tmpDir, 'multi-b.txt'), 'baz\nqux\n')
    applier.markRead(path.join(tmpDir, 'multi-a.txt'))
    applier.markRead(path.join(tmpDir, 'multi-b.txt'))

    const input = [
      '```edit',
      'file: multi-a.txt',
      'old: |',
      '  foo',
      'new: |',
      '  FOO',
      '```',
      '```edit',
      'file: multi-b.txt',
      'old: |',
      '  baz',
      'new: |',
      '  BAZ',
      '```',
    ].join('\n')
    const r = await tool().execute({ content: input })
    expect(r.success).toBe(true)
    expect(fs.readFileSync(path.join(tmpDir, 'multi-a.txt'), 'utf8')).toContain('FOO')
    expect(fs.readFileSync(path.join(tmpDir, 'multi-b.txt'), 'utf8')).toContain('BAZ')
  })
})

// ── Advanced edge cases ──────────────────────────────────────────────────
describe('edit tool �?edge cases', () => {
  let tmpDir: string
  let applier: FileReadTracker

  beforeAll(() => {
    tmpDir = makeTempDir()
    applier = makeApplier()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  describe('special characters', () => {
    it('handles unicode characters', async () => {
      const file = path.join(tmpDir, 'unicode.txt')
      fs.writeFileSync(file, 'héllo wörld\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'unicode.txt', old_string: 'héllo wörld', new_string: 'HELLO WORLD' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('HELLO WORLD\n')
    })

    it('handles emoji characters', async () => {
      const file = path.join(tmpDir, 'emoji.txt')
      fs.writeFileSync(file, 'hello 👍 world\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          { file_path: 'emoji.txt', old_string: 'hello 👍 world', new_string: 'hello world' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('hello world\n')
    })

    it('handles Chinese characters', async () => {
      const file = path.join(tmpDir, 'chinese.txt')
      fs.writeFileSync(file, '你好世界\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'chinese.txt', old_string: '你好世界', new_string: 'Hello World' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('Hello World\n')
    })

    it('handles tab characters', async () => {
      const file = path.join(tmpDir, 'tabs.txt')
      fs.writeFileSync(file, 'a\tb\nc\td\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'tabs.txt', old_string: 'a\tb', new_string: 'A\tB' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('A\tB\nc\td\n')
    })
  })

  describe('empty and boundary files', () => {
    it('edits a file with single line', async () => {
      const file = path.join(tmpDir, 'single.txt')
      fs.writeFileSync(file, 'only line\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'single.txt', old_string: 'only line', new_string: 'replaced line' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('replaced line\n')
    })

    it('edits a file with no trailing newline', async () => {
      const file = path.join(tmpDir, 'no-nl.txt')
      fs.writeFileSync(file, 'line one\nline two')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'no-nl.txt', old_string: 'line two', new_string: 'line TWO' }],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('line one\nline TWO')
    })

    it('appends to end of file', async () => {
      const file = path.join(tmpDir, 'append.txt')
      fs.writeFileSync(file, 'line one\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'append.txt',
            old_string: 'line one',
            new_string: 'line one\nline two',
          },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('line one\nline two\n')
    })

    it('replaces entire file content', async () => {
      const file = path.join(tmpDir, 'full-replace.txt')
      fs.writeFileSync(file, 'old content\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'full-replace.txt',
            old_string: 'old content',
            new_string: 'brand new content',
          },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toBe('brand new content\n')
    })
    it('rejects empty old_string on existing non-empty file', async () => {
      const file = path.join(tmpDir, 'empty-old-on-existing.txt')
      fs.writeFileSync(file, 'some content\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'empty-old-on-existing.txt',
            old_string: '',
            new_string: 'should not replace',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('already exists')
    })

    it('rejects create file when file already exists with empty content', async () => {
      const file = path.join(tmpDir, 'empty-existing-file.txt')
      fs.writeFileSync(file, '')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'empty-existing-file.txt',
            old_string: '',
            new_string: 'add content',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('already exists')
    })
  })

  describe('file path edge cases', () => {
    it('creates file in subdirectory that does not exist', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'deep/nested/dir/new-file.txt',
            old_string: '',
            new_string: 'created in nested dir',
          },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'deep/nested/dir/new-file.txt'), 'utf8')).toBe(
        'created in nested dir',
      )
    })

    it('handles file path with special characters', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'file-with-dashes_and_underscores.txt',
            old_string: '',
            new_string: 'special path',
          },
        ],
      })
      expect(r.success).toBe(true)
      expect(
        fs.readFileSync(path.join(tmpDir, 'file-with-dashes_and_underscores.txt'), 'utf8'),
      ).toBe('special path')
    })

    it('rejects path traversal with Windows drive letter', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'C:\\Windows\\system32\\drivers\\etc\\hosts',
            old_string: '',
            new_string: 'should not write',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')
    })
  })

  describe('path traversal security', () => {
    it('rejects path traversal with ../', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: '../../outside-cwd.txt',
            old_string: 'hello',
            new_string: 'world',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')
    })

    it('rejects path traversal with deep nested ../', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'subdir/../../../outside-cwd.txt',
            old_string: '',
            new_string: 'should not create',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')
    })

    it('rejects absolute path', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: '/etc/passwd',
            old_string: '',
            new_string: 'should not write',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')
    })

    it('allows normal paths inside cwd', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'safe-file.txt',
            old_string: '',
            new_string: 'safe content',
          },
        ],
      })
      expect(r.success).toBe(true)
    })

    it('rejects path traversal via markdown format', async () => {
      const input = '```edit\nfile: ../../escape.txt\nold:\nnew: |\n  hacked\n```'
      const r = await tool().execute({ content: input })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')
    })

    it('rejects path traversal via symlink (if supported)', async () => {
      let canSymlink = false
      const externalDir = path.join(os.tmpdir(), 'lonny-symlink-target-' + Date.now())
      const symLink = path.join(tmpDir, 'symlink-inside')
      try {
        fs.mkdirSync(externalDir, { recursive: true })
        fs.writeFileSync(path.join(externalDir, 'malicious.txt'), 'evil')
        fs.symlinkSync(externalDir, symLink, 'junction')
        canSymlink = fs.existsSync(symLink)
      } catch {
        canSymlink = false
      }
      if (!canSymlink) return

      const r = await tool().execute({
        edits: [
          {
            file_path: 'symlink-inside/malicious.txt',
            old_string: 'evil',
            new_string: 'hacked',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('traversal')

      // Cleanup
      try {
        fs.rmSync(externalDir, { recursive: true, force: true })
      } catch {}
    })
  })
  describe('error message quality', () => {
    it('includes proximity hint when old_string not found', async () => {
      const file = path.join(tmpDir, 'proximity.txt')
      fs.writeFileSync(file, 'keep this line\nfind me\nkeep that line\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'proximity.txt',
            old_string: 'find me\nnonexistent',
            new_string: 'x',
          },
        ],
      })
      expect(r.success).toBe(false)
      // Should include proximity info
      expect(r.error).toContain('Near line')
      expect(r.error).toContain('find me')
    })

    it('includes file content preview when no close match found', async () => {
      const file = path.join(tmpDir, 'preview.txt')
      fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          {
            file_path: 'preview.txt',
            old_string: 'zzz_nonexistent_zzz',
            new_string: 'x',
          },
        ],
      })
      expect(r.success).toBe(false)
      // Should include file content preview
      expect(r.error).toContain('File content')
      expect(r.error).toContain('alpha')
      expect(r.error).toContain('beta')
    })

    it('includes read warning when file not read first', async () => {
      // Don't call markRead �?simulate stale content
      const file = path.join(tmpDir, 'no-read.txt')
      fs.writeFileSync(file, 'content\n')
      const r = await tool().execute({
        edits: [
          {
            file_path: 'no-read.txt',
            old_string: 'zzz',
            new_string: 'x',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('was not read first')
    })

    it('includes rawInput in error for easy debugging', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'nonexistent.txt',
            old_string: 'hello',
            new_string: 'world',
          },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('nonexistent.txt')
      expect(r.error).toContain('hello')
      expect(r.error).toContain('world')
    })
  })

  describe('output format', () => {
    it('prefixes output with "Edited" for modifications', async () => {
      const file = path.join(tmpDir, 'output-test.txt')
      fs.writeFileSync(file, 'original\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [{ file_path: 'output-test.txt', old_string: 'original', new_string: 'modified' }],
      })
      expect(r.success).toBe(true)
      expect(r.output).toContain('Edited')
    })

    it('prefixes output with "Created" for new files', async () => {
      const r = await tool().execute({
        edits: [{ file_path: 'output-create.txt', old_string: '', new_string: 'new file' }],
      })
      expect(r.success).toBe(true)
      expect(r.output).toContain('Created')
    })

    it('includes line count for created files', async () => {
      const r = await tool().execute({
        edits: [
          {
            file_path: 'output-count.txt',
            old_string: '',
            new_string: 'line1\nline2\nline3',
          },
        ],
      })
      expect(r.success).toBe(true)
      expect(r.output).toContain('3 lines')
    })
  })

  describe('concurrent edits to same line area', () => {
    it('applies edits bottom-to-top within same file', async () => {
      const file = path.join(tmpDir, 'concurrent.txt')
      fs.writeFileSync(file, 'first\nsecond\nthird\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          { file_path: 'concurrent.txt', old_string: 'first', new_string: 'FIRST' },
          { file_path: 'concurrent.txt', old_string: 'third', new_string: 'THIRD' },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(file, 'utf8')
      expect(content).toBe('FIRST\nsecond\nTHIRD\n')
    })

    it('applies edits bottom-to-top to avoid line offset issues', async () => {
      const file = path.join(tmpDir, 'offset.txt')
      fs.writeFileSync(file, 'a\nb\nc\n')
      applier.markRead(file)
      // If applied top-to-bottom: after replacing "a" with "A1\nA2",
      // "c" would be at line 4, not line 2
      const r = await tool().execute({
        edits: [
          { file_path: 'offset.txt', old_string: 'a', new_string: 'A1\nA2' },
          { file_path: 'offset.txt', old_string: 'c', new_string: 'C' },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(file, 'utf8')
      expect(content).toBe('A1\nA2\nb\nC\n')
    })
  })

  describe('CRLF handling', () => {
    it('handles CRLF in file content', async () => {
      const file = path.join(tmpDir, 'crlf-content.txt')
      fs.writeFileSync(file, 'hello\r\nworld\r\n')
      applier.markRead(file)
      const r = await tool().execute({
        edits: [
          { file_path: 'crlf-content.txt', old_string: 'hello\nworld', new_string: 'HELLO\nWORLD' },
        ],
      })
      expect(r.success).toBe(true)
      const content = fs.readFileSync(file, 'utf8')
      expect(content).toBe('HELLO\nWORLD\n')
    })
  })

  describe('rollback behavior', () => {
    it('restores original file content on failure', async () => {
      const file = path.join(tmpDir, 'rollback-restore.txt')
      fs.writeFileSync(file, 'original content\n')
      applier.markRead(file)
      const original = fs.readFileSync(file, 'utf8')

      const r = await tool().execute({
        edits: [
          {
            file_path: 'rollback-restore.txt',
            old_string: 'original content',
            new_string: 'changed',
          },
          { file_path: 'rollback-restore.txt', old_string: 'nonexistent', new_string: 'fail' },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('rolled back')
      // File should be restored to original
      expect(fs.readFileSync(file, 'utf8')).toBe(original)
    })

    it('deletes newly created file on rollback', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'rollback-new.txt', old_string: '', new_string: 'new file' },
          { file_path: 'rollback-new.txt', old_string: '', new_string: 'duplicate' },
        ],
      })
      expect(r.success).toBe(false)
      expect(fs.existsSync(path.join(tmpDir, 'rollback-new.txt'))).toBe(false)
    })
  })

  describe('multi-file scenarios', () => {
    beforeAll(() => {
      fs.writeFileSync(path.join(tmpDir, 'mf-a.txt'), 'edit me\n')
      fs.writeFileSync(path.join(tmpDir, 'mf-b.txt'), 'edit me too\n')
      applier.markRead(path.join(tmpDir, 'mf-a.txt'))
      applier.markRead(path.join(tmpDir, 'mf-b.txt'))
    })

    it('edits multiple existing files in one call', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'mf-a.txt', old_string: 'edit me', new_string: 'edited' },
          { file_path: 'mf-b.txt', old_string: 'edit me too', new_string: 'edited too' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'mf-a.txt'), 'utf8')).toBe('edited\n')
      expect(fs.readFileSync(path.join(tmpDir, 'mf-b.txt'), 'utf8')).toBe('edited too\n')
    })

    it('mixes create and edit across files', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'mf-a.txt', old_string: 'edited', new_string: 'edited again' },
          { file_path: 'mf-create-new.txt', old_string: '', new_string: 'newly created' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'mf-a.txt'), 'utf8')).toBe('edited again\n')
      expect(fs.readFileSync(path.join(tmpDir, 'mf-create-new.txt'), 'utf8')).toBe('newly created')
    })

    it('rolls back mixed create+edit on failure', async () => {
      const origA = fs.readFileSync(path.join(tmpDir, 'mf-a.txt'), 'utf8')

      const r = await tool().execute({
        edits: [
          { file_path: 'mf-a.txt', old_string: 'edited again', new_string: 'changed' },
          { file_path: 'mf-rollback-new.txt', old_string: '', new_string: 'will be deleted' },
          { file_path: 'mf-nonexistent.txt', old_string: 'nope', new_string: 'x' },
        ],
      })
      expect(r.success).toBe(false)
      expect(r.error).toContain('rolled back')
      // Existing file restored
      expect(fs.readFileSync(path.join(tmpDir, 'mf-a.txt'), 'utf8')).toBe(origA)
      // Created file should be deleted
      expect(fs.existsSync(path.join(tmpDir, 'mf-rollback-new.txt'))).toBe(false)
    })

    it('creates multiple files in subdirectories', async () => {
      const r = await tool().execute({
        edits: [
          { file_path: 'multi-dir/sub1/x.ts', old_string: '', new_string: '// x' },
          { file_path: 'multi-dir/sub2/y.ts', old_string: '', new_string: '// y' },
        ],
      })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'multi-dir/sub1/x.ts'), 'utf8')).toBe('// x')
      expect(fs.readFileSync(path.join(tmpDir, 'multi-dir/sub2/y.ts'), 'utf8')).toBe('// y')
    })

    it('creates multiple files with markdown format', async () => {
      const input = [
        '```edit',
        'file: md-multi-1.txt',
        'old:',
        'new: |',
        '  first file',
        '```',
        '```edit',
        'file: md-multi-2.txt',
        'old:',
        'new: |',
        '  second file',
        '```',
      ].join('\n')
      const r = await tool().execute({ content: input })
      expect(r.success).toBe(true)
      expect(fs.readFileSync(path.join(tmpDir, 'md-multi-1.txt'), 'utf8')).toBe('  first file')
      expect(fs.readFileSync(path.join(tmpDir, 'md-multi-2.txt'), 'utf8')).toBe('  second file')
    })

    it('rolls back multi-file via markdown format on failure', async () => {
      const file = path.join(tmpDir, 'md-rollback-target.txt')
      fs.writeFileSync(file, 'preserve me\n')
      applier.markRead(file)

      const input = [
        '```edit',
        'file: md-rollback-target.txt',
        'old: |',
        '  preserve me',
        'new: |',
        '  changed',
        '```',
        '```edit',
        'file: md-nonexistent.txt',
        'old: |',
        '  not there',
        'new: |',
        '  fail',
        '```',
      ].join('\n')
      const r = await tool().execute({ content: input })
      expect(r.success).toBe(false)
      expect(r.error).toContain('rolled back')
      // Target file should be restored
      expect(fs.readFileSync(file, 'utf8')).toBe('preserve me\n')
    })
  })
})

// ── Model-generated edit format integration tests ──────────────────────
// These tests call a real LLM (DeepSeek-V4-Flash via ~/.lonny/config.json)
// to generate edit format content, then feed it into the edit tool.

const LONNY_CONFIG_PATH = path.join(os.homedir(), '.lonny', 'config.json')

interface LonnyConfig {
  apiKey?: string
  baseUrl?: string
  provider?: string
  model?: string
}

function loadLonnyConfig(): LonnyConfig {
  try {
    return JSON.parse(fs.readFileSync(LONNY_CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

const lonnyConfig = loadLonnyConfig()
const hasApiKey = !!lonnyConfig.apiKey

/** Call the model with a prompt and return the full text response (non-streaming). */
async function callModel(prompt: string, signal?: AbortSignal): Promise<string> {
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({
    apiKey: lonnyConfig.apiKey,
    baseURL: lonnyConfig.baseUrl,
  })

  const response = await client.chat.completions.create(
    {
      model: lonnyConfig.model || 'deepseek-v4-flash',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: 4096,
    },
    signal ? { signal } : undefined,
  )

  return response.choices[0]?.message?.content || ''
}

describe.runIf(hasApiKey)('model-generated edit format', () => {
  const MODEL_TIMEOUT = 60_000 // Model API calls can take 10-30s
  let tmpDir: string
  let applier: FileReadTracker

  beforeAll(() => {
    tmpDir = makeTempDir()
    applier = new FileReadTracker()
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const tool = () => createEditTool(applier, tmpDir)

  it('model replaces exact string in a file', { timeout: MODEL_TIMEOUT }, async () => {
    const file = path.join(tmpDir, 'simple.txt')
    fs.writeFileSync(file, 'hello world\nfoo bar\n')
    applier.markRead(file)

    const prompt = [
      'Output ONLY an edit code block (```edit ... ```) that replaces "hello world" with "hello universe" in file "simple.txt".',
      '',
      'The EXACT format is:',
      '```edit',
      'file: simple.txt',
      'old: |',
      '  hello world',
      'new: |',
      '  hello universe',
      '```',
      '',
      'Do NOT add quotes, do NOT add backticks around the text inside old/new. Output ONLY the code block.',
    ].join('\n')

    const modelOutput = await callModel(prompt)
    const edits = parseMarkdownEdit(modelOutput)
    expect(edits.length).toBeGreaterThanOrEqual(1)

    const result = await tool().execute({ content: modelOutput })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('hello universe')
    expect(content).toContain('foo bar')
  })

  it('model replaces multi-line text in a file', { timeout: MODEL_TIMEOUT }, async () => {
    const file = path.join(tmpDir, 'multiline.txt')
    fs.writeFileSync(file, 'line A\nline B\nline C\nline D\n')
    applier.markRead(file)

    const prompt = [
      'Output ONLY an edit code block that replaces:',
      '',
      '  line B',
      '  line C',
      '',
      'with:',
      '',
      '  line X',
      '  line Y',
      '',
      `in file "multiline.txt".`,
      '',
      'Format:',
      '```edit',
      'file: multiline.txt',
      'old: |',
      '  line B',
      '  line C',
      'new: |',
      '  line X',
      '  line Y',
      '```',
      '',
      'IMPORTANT: old: must contain EXACTLY "line B" and "line C" on separate lines with 2-space indent.',
      'Do NOT add quotes around the text. Output ONLY the code block.',
    ].join('\n')

    const modelOutput = await callModel(prompt)
    const edits = parseMarkdownEdit(modelOutput)
    expect(edits.length).toBeGreaterThanOrEqual(1)

    const result = await tool().execute({ content: modelOutput })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('line X')
    expect(content).toContain('line Y')
  })

  it('model creates a new file', { timeout: MODEL_TIMEOUT }, async () => {
    const prompt = [
      'Output ONLY an edit code block that CREATES a new file called "fresh.txt" with content "hello world".',
      '',
      'Format (note: old: has NO content - this means create):',
      '```edit',
      'file: fresh.txt',
      'old:',
      'new: |',
      '  hello world',
      '```',
      '',
      'Output ONLY the code block.',
    ].join('\n')

    const modelOutput = await callModel(prompt)
    const edits = parseMarkdownEdit(modelOutput)
    expect(edits.length).toBeGreaterThanOrEqual(1)
    expect(edits[0]!.file_path).toBe('fresh.txt')

    const result = await tool().execute({ content: modelOutput })
    expect(result.success).toBe(true)
    expect(fs.readFileSync(path.join(tmpDir, 'fresh.txt'), 'utf8')).toContain('hello world')
  })

  it('model edits a file with special characters (double quotes)', {
    timeout: MODEL_TIMEOUT,
  }, async () => {
    const file = path.join(tmpDir, 'quotes.txt')
    fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
    applier.markRead(file)

    const prompt = [
      'Output ONLY an edit code block that replaces "beta" with "BETA" in file "quotes.txt".',
      '',
      '```edit',
      'file: quotes.txt',
      'old: |',
      '  beta',
      'new: |',
      '  BETA',
      '```',
      '',
      'Output ONLY the code block. No extra text.',
    ].join('\n')

    const modelOutput = await callModel(prompt)
    const edits = parseMarkdownEdit(modelOutput)
    expect(edits.length).toBeGreaterThanOrEqual(1)

    const result = await tool().execute({ content: modelOutput })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('BETA')
    expect(content).toContain('alpha')
    expect(content).toContain('gamma')
  })

  it('model generates edit block that round-trips successfully', {
    timeout: MODEL_TIMEOUT,
  }, async () => {
    const file = path.join(tmpDir, 'roundtrip.txt')
    fs.writeFileSync(file, 'first\nsecond\nthird\nfourth\n')
    applier.markRead(file)

    const prompt = [
      'Output ONLY an edit code block that replaces "second" with "SECOND" in file "roundtrip.txt".',
      'Include 1 line of context before and after to ensure uniqueness.',
      '',
      'Format:',
      '```edit',
      'file: roundtrip.txt',
      'old: |',
      '  first',
      '  second',
      '  third',
      'new: |',
      '  first',
      '  SECOND',
      '  third',
      '```',
      '',
      'Output ONLY the code block.',
    ].join('\n')

    const modelOutput = await callModel(prompt)
    const edits = parseMarkdownEdit(modelOutput)
    expect(edits.length).toBeGreaterThanOrEqual(1)

    const result = await tool().execute({ content: modelOutput })
    expect(result.success).toBe(true)
    const content = fs.readFileSync(file, 'utf8')
    expect(content).toContain('SECOND')
    expect(content).toContain('fourth')
  })
})
