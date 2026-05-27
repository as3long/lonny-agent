import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

// We test loadTokenUsage, saveTokenUsage, resetTokenUsage, and listAllTokenUsage
// by mocking the homedir so they write to a temp dir.
const ORIGINAL_HOME = process.env.HOME

function setMockHome(tmpDir: string) {
  process.env.HOME = tmpDir
  if (os.platform() === 'win32') {
    process.env.USERPROFILE = tmpDir
  }
}

function restoreHome() {
  if (ORIGINAL_HOME !== undefined) {
    process.env.HOME = ORIGINAL_HOME
  } else {
    delete process.env.HOME
  }
  if (os.platform() === 'win32') {
    delete process.env.USERPROFILE
  }
}

describe('token usage persistence', () => {
  let tmpDir: string
  let originalOsHomedir: typeof os.homedir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-tokens-test-'))
    setMockHome(tmpDir)
    // Re-import after changing env
  })

  afterEach(() => {
    restoreHome()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('save and load token usage', async () => {
    const { saveTokenUsage, loadTokenUsage } = await import('../tokens.js')
    const result = saveTokenUsage(tmpDir, 100, 50, 3)
    expect(result.totalInputTokens).toBe(100)
    expect(result.totalOutputTokens).toBe(50)
    expect(result.totalApiCalls).toBe(3)

    const loaded = loadTokenUsage(tmpDir)
    expect(loaded.totalInputTokens).toBe(100)
    expect(loaded.totalOutputTokens).toBe(50)
    expect(loaded.totalApiCalls).toBe(3)
  })

  test('save accumulates across calls', async () => {
    const { saveTokenUsage, loadTokenUsage } = await import('../tokens.js')
    saveTokenUsage(tmpDir, 10, 20, 1)
    saveTokenUsage(tmpDir, 30, 40, 2)
    const loaded = loadTokenUsage(tmpDir)
    expect(loaded.totalInputTokens).toBe(40)
    expect(loaded.totalOutputTokens).toBe(60)
    expect(loaded.totalApiCalls).toBe(3)
  })

  test('load returns zeros for non-existent file', async () => {
    const { loadTokenUsage } = await import('../tokens.js')
    const loaded = loadTokenUsage(tmpDir)
    expect(loaded.totalInputTokens).toBe(0)
    expect(loaded.totalOutputTokens).toBe(0)
    expect(loaded.totalApiCalls).toBe(0)
  })

  test('reset sets all counters to zero', async () => {
    const { saveTokenUsage, resetTokenUsage, loadTokenUsage } = await import('../tokens.js')
    saveTokenUsage(tmpDir, 100, 50, 3)
    resetTokenUsage(tmpDir)
    const loaded = loadTokenUsage(tmpDir)
    expect(loaded.totalInputTokens).toBe(0)
    expect(loaded.totalOutputTokens).toBe(0)
    expect(loaded.totalApiCalls).toBe(0)
  })

  test('listAllTokenUsage returns all projects sorted by date', async () => {
    const { saveTokenUsage, listAllTokenUsage } = await import('../tokens.js')

    // Save for two "projects"
    const project1 = path.join(tmpDir, 'proj1')
    const project2 = path.join(tmpDir, 'proj2')
    fs.mkdirSync(project1, { recursive: true })
    fs.mkdirSync(project2, { recursive: true })

    saveTokenUsage(project1, 10, 5, 1)
    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 10))
    saveTokenUsage(project2, 20, 10, 2)

    const all = listAllTokenUsage()
    expect(all.length).toBeGreaterThanOrEqual(2)
    // Should be sorted newest first
    expect(all[0].totalApiCalls).toBe(2)
    expect(all[1].totalApiCalls).toBe(1)
  })
})
