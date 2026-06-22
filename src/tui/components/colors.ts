import * as fs from 'node:fs'

export const colors = {
  bgDark: '#1e1e1e',
  bgDim: '#191919',
  headerBg: '#2a2a3a',
  separator: '#3c3c3c',
  statusBg: '#191923',
  running: '#00ff64',
  idle: '#969696',
  doneTodo: '#64c864',
  todo: '#969696',
  accent: '#00aaff',
  dim: '#5a5a5a',
  userLabel: '#ffc832',
  assistantLabel: '#00ff96',
  error: '#ff5050',
  success: '#00c864',
  inputPrompt: '#00aaff',
  warn: '#ffc832',
}

const APP_VERSION: string = (() => {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    return JSON.parse(raw).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

export { APP_VERSION }
