import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import * as url from 'node:url'
import { type WebSocket, WebSocketServer } from 'ws'
import { resetGlobalEventBus } from '../agent/event-bus.js'
import { Session } from '../agent/session.js'
import type { Config } from '../config/index.js'
import { fmtErr } from '../tools/errors.js'
import { startSessionBridge, type WsMessage } from './session-bridge.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

/**
 * Strip ANSI escape codes from a string.
 * These are terminal control sequences (\x1b[...m) that are meaningless in the browser.
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}

/**
 * Find the public/ directory at runtime.
 * - tsx dev mode: __dirname = src/web/, public/ is right there
 * - built dist/ with copy:web: __dirname = dist/web/, public/ was copied alongside
 * - built dist/ without copy: fallback to src/web/public/ relative to cwd
 */
function findPublicDir(): string {
  const local = path.resolve(__dirname, 'public')
  if (fs.existsSync(local)) return local
  // Fallback: project root's src/web/public/ (for dist builds that skipped copy:web)
  const fromCwd = path.resolve(process.cwd(), 'src', 'web', 'public')
  if (fs.existsSync(fromCwd)) return fromCwd
  return local // will fail with a clear ENOENT if neither exists
}

const PUBLIC_DIR = findPublicDir()

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): void {
  let reqPath = req.url || '/'
  if (reqPath === '/') reqPath = '/index.html'

  const filePath = path.join(PUBLIC_DIR, reqPath)

  // Security: prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }

    const ext = path.extname(filePath).toLowerCase()
    const contentType = MIME_TYPES[ext] || 'application/octet-stream'
    const content = fs.readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  } catch {
    res.writeHead(500)
    res.end('Internal Server Error')
  }
}

export async function startWebUi(config: Config, port: number): Promise<void> {
  // Create HTTP server
  const server = http.createServer(serveStatic)

  // Create WebSocket server
  const wss = new WebSocketServer({ server })

  wss.on('connection', (ws: WebSocket) => {
    console.log('[Web UI] Client connected')

    // Reset event bus for new session
    resetGlobalEventBus()

    const session = Session.load(config) || new Session(config)
    let bridge: ReturnType<typeof startSessionBridge> | null = null

    // Track output to forward to WebSocket
    // Strip ANSI codes since they are meaningless in the browser
    const output = {
      write: (text: string) => {
        const clean = stripAnsi(text)
        if (clean) {
          ws.send(JSON.stringify({ type: 'chunk', text: clean }))
        }
      },
      suppressToolOutput: true, // EventBus handles tool call display
    }

    // Re-create session with output
    const sessionWithOutput = Session.load(config, output) || new Session(config, output)
    sessionWithOutput.messages = session.messages
    sessionWithOutput.totalInputTokens = session.totalInputTokens
    sessionWithOutput.totalOutputTokens = session.totalOutputTokens
    sessionWithOutput.totalApiCalls = session.totalApiCalls

    // Set plan written callback
    sessionWithOutput.onPlanWritten = (display: string) => {
      ws.send(JSON.stringify({ type: 'plan_written', display }))
    }

    // Start bridge
    bridge = startSessionBridge(sessionWithOutput, config, (msg: WsMessage) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    })

    // Handle incoming messages
    ws.on('message', async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage
        if (msg.type === 'message') {
          const text = String(msg.text || '')

          // Handle slash commands
          if (text.startsWith('/')) {
            const parts = text.slice(1).split(/\s+/)
            const cmd = parts[0]
            const arg = parts.slice(1).join(' ')

            if (cmd === 'mode' && (arg === 'code' || arg === 'plan' || arg === 'ask')) {
              sessionWithOutput.setMode(arg as 'code' | 'plan' | 'ask')
              ws.send(JSON.stringify({ type: 'mode_changed', mode: arg }))
              return
            }

            if (cmd === 'model' && arg) {
              sessionWithOutput.config.model = arg
              sessionWithOutput.setMode(sessionWithOutput.config.mode)
              ws.send(JSON.stringify({ type: 'model_changed', model: arg }))
              return
            }

            if (cmd === 'new') {
              Session.clearSavedSession(config.cwd)
              ws.send(JSON.stringify({ type: 'session_cleared' }))
              ws.send(JSON.stringify({ type: 'done', reason: 'stop' }))
              return
            }

            if (cmd === 'help') {
              ws.send(
                JSON.stringify({
                  type: 'help',
                  commands: [
                    '/mode code|plan|ask - Switch mode',
                    '/model <name> - Switch model',
                    '/new - Start a new session',
                    '/help - Show this help',
                  ],
                }),
              )
              return
            }

            ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${cmd}` }))
            return
          }

          // Send to session
          try {
            await sessionWithOutput.chat(text)
            ws.send(JSON.stringify({ type: 'done', reason: 'stop' }))
          } catch (err) {
            const errMsg = fmtErr(err)
            ws.send(JSON.stringify({ type: 'error', message: errMsg }))
            ws.send(JSON.stringify({ type: 'done', reason: 'error' }))
          }
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        } else if (msg.type === 'stop') {
          sessionWithOutput.stop()
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
      }
    })

    ws.on('close', () => {
      console.log('[Web UI] Client disconnected')
      if (bridge) bridge.close()
    })

    ws.on('error', err => {
      console.error('[Web UI] WebSocket error:', err.message)
      if (bridge) bridge.close()
    })

    // Send initial state with current token stats
    ws.send(
      JSON.stringify({
        type: 'hello',
        version: 1,
        mode: config.mode,
        model: config.model,
        provider: config.provider,
        totalIn: sessionWithOutput.totalInputTokens,
        totalOut: sessionWithOutput.totalOutputTokens,
        totalApi: sessionWithOutput.totalApiCalls,
      }),
    )
  })

  // Start server
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      console.log(`\n  Lonny Web UI running at http://127.0.0.1:${port}`)
      console.log(`  Press Ctrl+C to stop\n`)
      resolve()
    })
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Try a different port with --port.`)
      } else {
        console.error('Failed to start server:', err.message)
      }
      reject(err)
    })
  })
}
