import { describe, it, expect } from 'vitest'
import { bashTool } from '../bash.js'

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
})
