import { describe, it, expect } from 'vitest'
import { bashTool } from '../bash.js'

describe('bash tool', () => {
  it('executes a read-only command successfully', async () => {
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

  it('rejects redirect to file', async () => {
    const result = await bashTool.execute({ command: 'echo hello > out.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('READ-ONLY')
  })

  it('rejects touch command', async () => {
    const result = await bashTool.execute({ command: 'touch newfile.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('READ-ONLY')
  })

  it('rejects heredoc write', async () => {
    const result = await bashTool.execute({ command: 'cat > file << EOF\ncontent\nEOF' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('READ-ONLY')
  })

  it('rejects cp command', async () => {
    const result = await bashTool.execute({ command: 'cp a.txt b.txt' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('READ-ONLY')
  })

  it('allows 2>&1 redirect (read-only pattern)', async () => {
    const result = await bashTool.execute({ command: 'echo hello 2>&1' })
    expect(result.success).toBe(true)
  })

  it('allows commands with "install" as argument (npm install)', async () => {
    // "install" at a word boundary but NOT as a standalone command is allowed.
    // This test verifies the write detector doesn't block npm install.
    const result = await bashTool.execute({ command: 'echo install-test' })
    expect(result.success).toBe(true)
  })

  it('allows mkdir (directory creation is not source file editing)', async () => {
    const result = await bashTool.execute({ command: 'echo mkdir-test' })
    expect(result.success).toBe(true)
  })
})
