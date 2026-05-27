import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileReadTracker } from '../apply.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-test-'))
}

describe('FileReadTracker', () => {
  let tmpDir: string
  let filePath: string

  beforeAll(() => {
    tmpDir = makeTempDir()
    filePath = path.join(tmpDir, 'test.txt')
    fs.writeFileSync(filePath, 'hello world\n', 'utf-8')
  })

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('marks a file as read', () => {
    const tracker = new FileReadTracker()
    tracker.markRead(filePath)
    expect(tracker.checkModified(filePath)).toBeNull()
  })

  it('returns error for unread file', () => {
    const tracker = new FileReadTracker()
    const result = tracker.checkModified(path.join(tmpDir, 'nonexistent.txt'))
    expect(result).toContain('was not read')
  })

  it('returns error for externally modified file', () => {
    const tracker = new FileReadTracker()
    tracker.markRead(filePath)
    // Modify the file externally
    fs.writeFileSync(filePath, 'modified content\n', 'utf-8')
    const result = tracker.checkModified(filePath)
    expect(result).toContain('modified externally')
  })

  it('returns error for deleted file', () => {
    const tracker = new FileReadTracker()
    const tempFile = path.join(tmpDir, 'temp.txt')
    fs.writeFileSync(tempFile, 'temp\n', 'utf-8')
    tracker.markRead(tempFile)
    fs.unlinkSync(tempFile)
    const result = tracker.checkModified(tempFile)
    expect(result).toContain('no longer exists')
  })

  it('handles multiple files independently', () => {
    const tracker = new FileReadTracker()
    const fileA = path.join(tmpDir, 'a.txt')
    const fileB = path.join(tmpDir, 'b.txt')
    fs.writeFileSync(fileA, 'a\n', 'utf-8')
    fs.writeFileSync(fileB, 'b\n', 'utf-8')

    tracker.markRead(fileA)
    expect(tracker.checkModified(fileA)).toBeNull()
    expect(tracker.checkModified(fileB)).toContain('was not read')
  })
})
