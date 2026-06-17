import { execSync } from 'node:child_process'
import * as os from 'node:os'

function detectEnv(): { osInfo: string; shell: string } {
  const platform = os.platform()
  const release = os.release()
  const arch = os.arch()

  if (platform === 'win32') {
    return {
      osInfo: `Windows ${release} (${arch})`,
      shell: 'powershell.exe',
    }
  }

  const osName = platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform
  return {
    osInfo: `${osName} ${release} (${arch})`,
    shell: process.env.SHELL || '/bin/sh',
  }
}

export const env = detectEnv()

/**
 * Detect Windows console code page to handle non-UTF-8 output correctly.
 * Falls back to 'utf-8' if detection fails.
 * On non-Windows platforms, always returns 'utf-8'.
 */
function detectEncoding(): string {
  if (os.platform() !== 'win32') return 'utf-8'
  try {
    const result = execSync('[Console]::OutputEncoding.CodePage', {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 2000,
      windowsHide: true,
      encoding: 'utf-8',
      shell: 'powershell.exe',
    })
    const cp = Number.parseInt(result.toString().trim(), 10)
    // Common Windows code pages that need special handling
    if (cp === 936) return 'gbk' // Chinese (Simplified)
    if (cp === 950) return 'big5' // Chinese (Traditional)
    if (cp === 932) return 'shift-jis' // Japanese
    if (cp === 949) return 'euc-kr' // Korean
    if (
      cp === 1250 ||
      cp === 1251 ||
      cp === 1252 ||
      cp === 1253 ||
      cp === 1254 ||
      cp === 1255 ||
      cp === 1256 ||
      cp === 1257
    ) {
      return `cp${cp}` // Windows code page
    }
    return 'utf-8'
  } catch {
    return 'utf-8'
  }
}

// Cache encoding detection once at startup
export const ENCODING = detectEncoding()
