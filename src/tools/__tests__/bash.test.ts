import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { bashTool } from '../execute/bash.js'

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-test-'))
}

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
    expect(result.error).toContain('Command exited with code 1')
  })

  it('accepts custom timeout', async () => {
    const result = await bashTool.execute({ command: 'echo timed', timeout: 5000 })
    expect(result.success).toBe(true)
    expect(result.output).toContain('timed')
  })

  it('includes description in output when provided', async () => {
    const result = await bashTool.execute({
      command: 'echo hello',
      description: 'testing description',
    })
    expect(result.success).toBe(true)
    expect(result.output).toContain('[bash]')
    expect(result.output).toContain('testing description')
    expect(result.output).toContain('hello')
  })

  it('runs command in specified cwd', async () => {
    const tmpDir = makeTempDir()
    try {
      // Create a marker file so we can verify cwd
      const result = await bashTool.execute({ command: 'pwd', cwd: tmpDir })
      expect(result.success).toBe(true)
      // On Windows, PowerShell's Get-Location returns the path
      // We just need to check the command executed without error
      if (os.platform() === 'win32') {
        // PowerShell: use Get-Location instead of pwd
        const result2 = await bashTool.execute({
          command: `Get-Location | Select-Object -ExpandProperty Path`,
          cwd: tmpDir,
        })
        expect(result2.success).toBe(true)
        const normalizedOutput = result2.output.replace(/\\/g, '/')
        const normalizedTmp = tmpDir.replace(/\\/g, '/')
        expect(normalizedOutput).toContain(normalizedTmp)
      } else {
        expect(result.output).toContain(tmpDir)
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('handles stderr output separately', async () => {
    // PowerShell: write to stderr using Write-Error
    const result = await bashTool.execute({
      command: 'Write-Error "test error" 2>&1 | Out-Null; Write-Output "stdout ok"',
    })
    // 2>&1 redirects stderr to stdout in PowerShell, so it should succeed
    expect(result.success).toBe(true)
  })

  it('shows (no output) for empty output', async () => {
    // A command that produces no output
    const result = await bashTool.execute({ command: 'Write-Output ""' })
    expect(result.success).toBe(true)
    expect(result.output).toContain('(no output)')
  })

  it('truncates very large output', async () => {
    // Generate a very large output to trigger truncation
    const result = await bashTool.execute({ command: '1..5000 | ForEach-Object { "Line $_" }' })
    expect(result.success).toBe(true)
    // Check if truncation warning is present (output > 10k chars)
    if (result.output.length > 10000) {
      expect(result.output).toContain('truncated at')
    }
  })

  it('rejects whitespace-only command', async () => {
    const result = await bashTool.execute({ command: '   ' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('whitespace')
  })

  it('rejects non-string command type', async () => {
    const result = await bashTool.execute({ command: 123 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('must be a string')
  })

  it('rejects non-existent cwd', async () => {
    const result = await bashTool.execute({
      command: 'echo test',
      cwd: 'C:\\NonExistent_Directory_XYZ_123',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('does not exist')
  })

  it('blocks destructive rm -rf / command', async () => {
    const result = await bashTool.execute({ command: 'rm -rf /' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Destructive')
    expect(result.error).toContain('destroy')
  })

  it('blocks destructive format command', async () => {
    const result = await bashTool.execute({ command: 'format D: /Q' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Destructive')
    expect(result.error).toContain('destroy')
  })

  it('clamps timeout to valid range', async () => {
    // Very large timeout should be clamped, not cause error
    const result = await bashTool.execute({ command: 'echo ok', timeout: 999999999 })
    expect(result.success).toBe(true)
  })

  it('rejects filename-like command (no space before flag)', async () => {
    // This test verifies that the tool handles edge case input gracefully
    const result = await bashTool.execute({ command: '--version' })
    // Should fail with exit code 1, not crash
    expect(result.success).toBe(false)
  })

  it('blocks Remove-Item -Recurse -Force command', async () => {
    const result = await bashTool.execute({ command: 'Remove-Item C:\\Windows -Recurse -Force' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Destructive')
  })

  it('blocks diskpart clean-all command', async () => {
    const result = await bashTool.execute({ command: 'diskpart clean-all' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Destructive')
  })

  it('blocks reg delete command', async () => {
    const result = await bashTool.execute({ command: 'reg delete HKLM\\Software' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Destructive')
  })

  it('rejects cwd with path traversal', async () => {
    const result = await bashTool.execute({
      command: 'echo test',
      cwd: 'C:\\Users\\..\\Windows',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path traversal')
    expect(result.error).toContain('..')
  })

  it('rejects cwd with path traversal using forward slashes', async () => {
    const result = await bashTool.execute({
      command: 'echo test',
      cwd: '/Users/../etc',
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('path traversal')
  })

  it('redacts sensitive data from output', async () => {
    // Test redaction of API key pattern in output
    const result = await bashTool.execute({
      command: "Write-Output 'api_key=sk-abc123def456ghi789jkl012mno345pqr678stu'",
    })
    expect(result.success).toBe(true)
    // The API key should be redacted
    expect(result.output).not.toContain('sk-abc123def456ghi789jkl012mno345pqr678stu')
    expect(result.output).toContain('[REDACTED]')
  })

  it('redacts sensitive data from stderr', async () => {
    const result = await bashTool.execute({
      command: "Write-Error 'The token ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx is invalid'",
    })
    // Should not crash; the redacted marker should appear in the output/error
    if (!result.success && result.error) {
      // The token may be split across lines in PowerShell error formatting,
      // but [REDACTED] should appear at least once
      expect(result.error).toContain('[REDACTED]')
    }
  })

  it('shows platform-specific tip for grep on Windows', async () => {
    if (os.platform() === 'win32') {
      const result = await bashTool.execute({ command: 'grep "pattern" file.txt' })
      expect(result.success).toBe(false)
      expect(result.error).toContain('findstr')
    }
  })
})
