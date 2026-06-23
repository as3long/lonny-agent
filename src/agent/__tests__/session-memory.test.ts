import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolCall, ToolResult } from '../../tools/types.js'
import { processToolCall, resetAutoMemory, startTurn } from '../session-memory.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBashCall(command: string): ToolCall {
  return { id: 'tc-1', name: 'bash', input: { command } }
}

function makeEditCall(filePath: string, oldStr: string, newStr: string): ToolCall {
  return {
    id: 'tc-2',
    name: 'edit',
    input: { file_path: filePath, old_string: oldStr, new_string: newStr },
  }
}

function makeReadCall(paths: string[]): ToolCall {
  return { id: 'tc-3', name: 'read', input: { paths } }
}

function successResult(output: string): ToolResult {
  return { success: true, output }
}

function makeTmpDir(): string {
  const dir = fs.mkdtempSync('auto-memory-test-')
  fs.mkdirSync(path.join(dir, '.lonny', 'memory'), { recursive: true })
  return dir
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AutoMemory', () => {
  beforeEach(() => {
    resetAutoMemory()
  })

  describe('resetAutoMemory', () => {
    it('resets state without errors', () => {
      // Should not throw
      resetAutoMemory()
    })

    it('can be called multiple times', () => {
      resetAutoMemory()
      resetAutoMemory()
      resetAutoMemory()
    })
  })

  describe('startTurn', () => {
    it('increments turn counter without error', () => {
      startTurn()
      startTurn()
    })
  })

  describe('processToolCall - dev command detection', () => {
    it('saves memory for npm run dev', () => {
      const tmpDir = makeTmpDir()
      const tc = makeBashCall('npm run dev')
      startTurn() // need a turn so detection runs
      processToolCall(tc, successResult('Server started on port 3000'), tmpDir)

      // Check that memory was saved
      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBe(1)
      const content = JSON.parse(fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8'))
      expect(content.content).toContain('Development Server')
      expect(content.content).toContain('npm run dev')
      expect(content.tags).toContain('auto-saved')

      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('saves memory for npx serve', () => {
      const tmpDir = makeTmpDir()
      const tc = makeBashCall('npx serve dist')
      startTurn()
      processToolCall(tc, successResult('Serving!'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBe(1)
      const content = JSON.parse(fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8'))
      expect(content.content).toContain('Development Server')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })

  describe('processToolCall - error/fix pattern', () => {
    it('detects TypeScript errors', () => {
      const tmpDir = makeTmpDir()
      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const tc = makeBashCall('npx tsc --noEmit')
      // Need 2 error detections to reach threshold
      startTurn()
      processToolCall(
        tc,
        successResult('src/file.ts:5:3 - error TS2322: Type is not assignable'),
        tmpDir,
      )

      // Should NOT save yet (threshold is 2)
      expect(fs.readdirSync(memoryDir).length).toBe(0)

      // Second time → threshold reached
      startTurn()
      processToolCall(
        tc,
        successResult('src/other.ts:10:1 - error TS2322: Type is not assignable'),
        tmpDir,
      )

      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBe(1)
      const content = JSON.parse(fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8'))
      expect(content.content).toContain('error TS2322')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects test failures', () => {
      const tmpDir = makeTmpDir()
      const tc = makeBashCall('npx vitest run')

      // Two occurrences to trigger
      startTurn()
      processToolCall(tc, successResult('FAIL src/foo.test.ts > some test'), tmpDir)
      startTurn()
      processToolCall(tc, successResult('FAIL src/bar.test.ts > other test'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBe(1)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('does NOT save for successful bash output without errors', () => {
      const tmpDir = makeTmpDir()
      const tc = makeBashCall('echo hello')
      startTurn()
      processToolCall(tc, successResult('hello'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      expect(fs.readdirSync(memoryDir).length).toBe(0)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })

  describe('processToolCall - naming conventions', () => {
    it('detects I-prefix interfaces after 3 occurrences', () => {
      const tmpDir = makeTmpDir()

      // 3 reads of I-* files to reach threshold
      startTurn()
      processToolCall(makeReadCall(['src/IUserService.ts']), successResult('content'), tmpDir)
      startTurn()
      processToolCall(makeReadCall(['src/IOrderService.ts']), successResult('content'), tmpDir)
      startTurn()
      processToolCall(makeReadCall(['src/IProductRepo.ts']), successResult('content'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBe(1)
      const content = JSON.parse(fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8'))
      expect(content.content).toContain('I`-prefix for interfaces')
      expect(content.tags).toContain('auto-saved')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('detects test file convention after 3 occurrences', () => {
      const tmpDir = makeTmpDir()

      startTurn()
      processToolCall(makeReadCall(['src/user.test.ts']), successResult('content'), tmpDir)
      startTurn()
      processToolCall(makeReadCall(['src/order.spec.ts']), successResult('content'), tmpDir)
      startTurn()
      processToolCall(makeReadCall(['src/product.test.ts']), successResult('content'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      expect(files.length).toBeGreaterThanOrEqual(1)
      const content = JSON.parse(fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8'))
      expect(content.content).toContain('Test Convention')

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('does not save for single occurrence', () => {
      const tmpDir = makeTmpDir()

      startTurn()
      processToolCall(makeReadCall(['src/IUserService.ts']), successResult('content'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      expect(fs.readdirSync(memoryDir).length).toBe(0)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })

  describe('deduplication', () => {
    it('only saves the same pattern once', () => {
      const tmpDir = makeTmpDir()
      const tc = makeBashCall('npm run dev')

      // First time saves
      startTurn()
      processToolCall(tc, successResult('started'), tmpDir)

      // Second time should NOT save again (same key)
      startTurn()
      processToolCall(tc, successResult('started again'), tmpDir)

      const memoryDir = path.join(tmpDir, '.lonny', 'memory')
      const files = fs.readdirSync(memoryDir)
      // Need to handle the fact that the test might be called "dev-command" which saves on first occurrence
      // Actually dev-command saves on count=1 (THRESHOLD_DEV_COMMAND = 1)
      // So it saves once. Second call won't save again because p.saved = true
      expect(files.length).toBe(1)

      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
  })
})
