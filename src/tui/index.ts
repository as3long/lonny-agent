import * as os from 'node:os'
import { StringDecoder } from 'node:string_decoder'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { PlansPanel } from './plans-panel.js'
import { TodoPanel } from './todo-panel.js'
import { setOnPlanWritten } from '../tools/write_plan.js'

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'
const MOUSE_ON = '\x1b[?1000h\x1b[?1002h\x1b[?1006h'
const MOUSE_OFF = '\x1b[?1006l\x1b[?1002l\x1b[?1000l'
const HOME = '\x1b[H'
const SHOW = '\x1b[?25h'
const HIDE = '\x1b[?25l'
const RS = '\x1b[0m'
const GY = '\x1b[90m'
const CY = '\x1b[36m'
const GR = '\x1b[32m'
const YE = '\x1b[33m'
const RE = '\x1b[31m'
const MG = '\x1b[35m'

let chatContent = ''
let inputBuffer = ''
let isRunning = false
let needsRender = false
let session: Session
let plansPanel: PlansPanel
let todoPanel: TodoPanel

function cleanup(): void {
  process.stdin.removeAllListeners('data')
  process.stdout.write(SHOW)
  process.stdout.write(MOUSE_OFF)
  process.stdout.write(ALT_OFF)
  if (process.stdin.isTTY) {
    (process.stdin as typeof process.stdin).setRawMode(false)
  }
  process.stdin.pause()
}

function getDims(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\].*?(\x1b|\x07)/g, '')
}

function render(): void {
  needsRender = false
  const { cols, rows } = getDims()
  const hdrH = 1
  const botH = 1
  const inpH = 1
  const contentH = rows - hdrH - botH - inpH
  const showRight = cols >= 100
  const leftW = showRight ? Math.floor(cols * 0.7) : cols
  const rightW = showRight ? cols - leftW - 1 : 0
  const sepY = Math.floor(contentH / 2)
  const plansH = sepY
  const todosH = contentH - sepY

  let buf = HOME

  // Header (top border with embedded text)
  const cwd = session.config.cwd.replace(os.homedir(), '~')
  const modeLabel = session.config.mode === 'plan' ? 'plan' : 'code'
  const hdrRaw = ` lonny ${session.config.model} ${session.config.provider} ${modeLabel} ${cwd} `
  const hdrDisplay = hdrRaw.length > cols - 4 ? hdrRaw.slice(0, cols - 7) + '...' : hdrRaw
  buf += GY + '\u250c' + ' ' + hdrDisplay + ' ' + '\u2500'.repeat(Math.max(0, cols - stripAnsi(hdrDisplay).length - 4)) + '\u2510' + RS + '\n'

  // Content area
  const chatLines = buildChatLines(chatContent, leftW, contentH)

  for (let i = 0; i < contentH; i++) {
    const chatIdx = i - (contentH - chatLines.length)
    buf += GY + '\u2502' + RS

    // Left panel (chat)
    if (chatIdx >= 0) {
      const line = chatLines[chatIdx]
      buf += line + ' '.repeat(Math.max(0, leftW - stripAnsi(line).length))
    } else {
      buf += ' '.repeat(leftW)
    }

    if (showRight) {
      buf += GY + '\u2502' + RS

      // Right panel
      if (i < plansH) {
        const planLines = plansPanel.render(plansH, rightW)
        buf += planLines[i]
      } else {
        const todoLines = todoPanel.render(todosH, rightW)
        buf += todoLines[i - plansH]
      }
    }

    buf += GY + '\u2502' + RS + '\n'
  }

  // Bottom border
  buf += GY + '\u2514' + '\u2500'.repeat(cols - 2) + '\u2518' + RS + '\n'

  // Input bar
  const prompt = isRunning ? `${GY}*${RS}` : `${CY}>${RS}`
  const inputLine = ` ${prompt} ${inputBuffer}`
  const cursorPos = stripAnsi(inputLine).length + 1
  buf += inputLine + ' '.repeat(Math.max(0, cols - stripAnsi(inputLine).length))
  buf += `\x1b[${rows};${cursorPos}H`

  process.stdout.write(buf)
}

function buildChatLines(content: string, width: number, maxLines: number): string[] {
  const rawLines = content.split('\n')
  const result: string[] = []
  for (const line of rawLines) {
    const stripped = stripAnsi(line)
    if (stripped.length <= width) {
      result.push(line)
    } else {
      let visible = 0
      let truncated = ''
      let i = 0
      while (i < line.length && visible < width - 1) {
        if (line[i] === '\x1b') {
          const end = line.indexOf('m', i + 1)
          if (end > 0) {
            truncated += line.slice(i, end + 1)
            i = end + 1
          } else {
            truncated += line[i]
            i++
          }
        } else {
          truncated += line[i]
          visible++
          i++
        }
      }
      if (i < line.length) truncated += '\u2026'
      result.push(truncated)
    }
  }
  if (result.length > maxLines) {
    return result.slice(result.length - maxLines)
  }
  while (result.length < maxLines) {
    result.unshift('')
  }
  return result
}

function scheduleRender(): void {
  if (!needsRender) {
    needsRender = true
    setImmediate(render)
  }
}

let escBuffer = ''

function handleInput(text: string): void {
  for (const ch of text) {
    if (escBuffer) {
      escBuffer += ch
      if (/[a-zA-Z~]/.test(ch)) {
        handleEscape(escBuffer)
        escBuffer = ''
      }
    } else if (ch === '\x1b') {
      escBuffer = '\x1b'
    } else if (ch === '\r' || ch === '\n') {
      handleEnter()
    } else if (ch === '\x7f' || ch === '\b') {
      handleBackspace()
    } else if (ch === '\x03') {
      cleanup()
      process.exit(0)
    } else if (ch >= ' ' && !isRunning) {
      inputBuffer += ch
      scheduleRender()
    }
  }
}

function handleEscape(seq: string): void {
  const mouseMatch = seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/)
  if (mouseMatch) {
    const cb = parseInt(mouseMatch[1], 10)
    const cx = parseInt(mouseMatch[2], 10)
    const cy = parseInt(mouseMatch[3], 10)
    const isPress = mouseMatch[4] === 'M'
    if (isPress && cb < 64) {
      handleMouseClick(cx, cy)
    }
  }
}

function handleMouseClick(col: number, row: number): void {
  if (isRunning) return
  const { cols } = getDims()
  if (cols < 100) return
  const leftW = Math.floor(cols * 0.7)
  const rightStartX = leftW + 1
  const hdrH = 1
  const contentH = (getDims().rows || 24) - 3
  const sepY = Math.floor(contentH / 2)

  if (col < rightStartX || col >= cols - 1) return
  const listRow = row - hdrH - 1
  if (listRow < 0) return
  if (listRow < sepY) {
    plansPanel.setSelectedByClick(listRow)
    const sel = plansPanel.getSelected()
    if (sel) {
      todoPanel.loadFromFile(sel.fullPath)
    }
    scheduleRender()
  }
}

function handleEnter(): void {
  if (isRunning) return
  const trimmed = inputBuffer.trim()
  inputBuffer = ''
  scheduleRender()
  if (!trimmed) return

  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0]
    const arg = parts.slice(1).join(' ')

    if (cmd === 'exit' || cmd === 'quit') {
      chatContent += `\n  ${GY}*${RS} Goodbye!\n`
      scheduleRender()
      cleanup()
      process.exit(0)
      return
    }

    if (cmd === 'mode') {
      if (arg === 'code' || arg === 'plan') {
        session.setMode(arg)
        chatContent += `\n  ${GR}*${RS} Switched to ${arg} mode\n`
        scheduleRender()
      } else {
        chatContent += `\n  ${YE}*${RS} Usage: /mode code|plan  (current: ${session.config.mode})\n`
        scheduleRender()
      }
      return
    }

    chatContent += `\n  ${RE}*${RS} Unknown command: /${cmd}\n`
    scheduleRender()
    return
  }

  isRunning = true
  scheduleRender()
  session.chat(trimmed).then(() => {
    isRunning = false
    plansPanel.refresh()
    const sel = plansPanel.getSelected()
    if (sel) {
      todoPanel.loadFromFile(sel.fullPath)
    }
    scheduleRender()
  }).catch((err: unknown) => {
    isRunning = false
    chatContent += `\n  ${RE}x${RS} ${err instanceof Error ? err.message : String(err)}\n`
    scheduleRender()
  })
}

function handleBackspace(): void {
  if (isRunning) return
  if (inputBuffer.length > 0) {
    inputBuffer = inputBuffer.slice(0, -1)
    scheduleRender()
  }
}

export async function startTui(config: Config): Promise<void> {
  process.stdout.write(ALT_ON)
  process.stdout.write(HIDE)
  process.stdout.write(MOUSE_ON)

  plansPanel = new PlansPanel(config.cwd)
  plansPanel.refresh()
  todoPanel = new TodoPanel()

  setOnPlanWritten(() => {
    plansPanel.refresh()
    scheduleRender()
  })

  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      scheduleRender()
    },
  }

  session = new Session(config, output)

  // Raw mode input with UTF-8 StringDecoder for multi-byte safety
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()

  render()

  const stdinDecoder = new StringDecoder('utf-8')
  process.stdin.on('data', (data: string | Buffer) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    const text = stdinDecoder.write(buf)
    handleInput(text)
  })

  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })

  if (process.stdout.isTTY) {
    process.stdout.on('resize', () => {
      scheduleRender()
    })
  }

  await new Promise<void>(() => {})
}
