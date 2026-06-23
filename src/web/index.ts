import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import * as url from 'node:url'
import { type WebSocket, WebSocketServer } from 'ws'
import { type CommandUI, dispatchCommand } from '../agent/commands.js'
import { resetGlobalEventBus } from '../agent/event-bus.js'
import { Session, type SessionOutput } from '../agent/session.js'
import { fetchDeepSeekBalance, isDeepSeekOfficial } from '../api/balance.js'
import type { Config } from '../config/index.js'
import { fmtErr } from '../tools/errors.js'
import { listPlans, type PlanEntry } from '../tui/components/index.js'
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

  wss.on('connection', async (ws: WebSocket) => {
    console.log('[Web UI] Client connected')

    // Reset event bus for new session
    resetGlobalEventBus()

    let bridge: ReturnType<typeof startSessionBridge> | null = null
    let sessionWithOutput!: Session

    // Track output to forward to WebSocket
    // Strip ANSI codes since they are meaningless in the browser
    let pendingConfirm: ((approved: boolean) => void) | null = null
    let lastBalanceFetch = 0

    // Fetch DeepSeek balance and send to client (if 5+ min since last fetch)
    async function fetchAndSendBalance(): Promise<void> {
      const now = Date.now()
      if (now - lastBalanceFetch < 5 * 60 * 1000) return
      if (!isDeepSeekOfficial(config.baseUrl) || !config.apiKey) return
      try {
        const balance = await fetchDeepSeekBalance(config.apiKey)
        if (balance.isAvailable && balance.display) {
          lastBalanceFetch = now
          ws.send(
            JSON.stringify({
              type: 'balance_update',
              balance: balance.display,
              webBalance: balance.webDisplay,
            }),
          )
        }
      } catch {
        // Silently ignore balance fetch errors
      }
    }
    const output: SessionOutput = {
      write: (text: string) => {
        const clean = stripAnsi(text)
        if (clean) {
          ws.send(JSON.stringify({ type: 'chunk', text: clean }))
        }
      },
      suppressToolOutput: true, // EventBus handles tool call display
      confirmTool: async toolCalls => {
        ws.send(
          JSON.stringify({
            type: 'tool_confirm_request',
            toolCalls: toolCalls.map(tc => ({
              name: tc.name,
              input: tc.input,
              id: tc.id,
            })),
          }),
        )
        return new Promise<boolean>(resolve => {
          pendingConfirm = resolve
        })
      },
    }

    // Load or create session with output for WebSocket forwarding
    sessionWithOutput = (await Session.load(config, output)) || new Session(config, output)

    // Helper: read todos from a specific plan file (or first plan if no name given)
    function loadPlanTodos(
      plans: PlanEntry[],
      planName?: string,
    ): {
      name: string
      todos: { text: string; done: boolean }[]
    } {
      if (plans.length === 0) return { name: '', todos: [] }
      const plan = planName ? plans.find(p => p.name === planName) : plans[0]
      if (!plan) return { name: planName || '', todos: [] }
      const todos: { text: string; done: boolean }[] = []
      try {
        const content = fs.readFileSync(plan.fullPath, 'utf-8')
        const lines = content.split('\n')
        for (const raw of lines) {
          const line = raw.trim()
          const m = line.match(/^- \[([ x])\]\s+(.+)/)
          if (m) {
            todos.push({ text: m[2], done: m[1] === 'x' })
          }
        }
      } catch {
        // Ignore file read errors
      }
      return { name: plan.name, todos }
    }

    // Helper: send plan & todo data to client
    function sendPlanData(): void {
      try {
        const planEntries = listPlans(config.cwd)
        const { name, todos } = loadPlanTodos(planEntries)
        ws.send(
          JSON.stringify({
            type: 'plan_data',
            plans: planEntries.map(p => ({
              name: p.name,
              mtime: p.mtime,
            })),
            currentPlanName: name,
            todos,
          }),
        )
      } catch {
        // Silently ignore
      }
    }

    // Set plan written callback
    sessionWithOutput.onPlanWritten = (display: string) => {
      ws.send(JSON.stringify({ type: 'plan_written', display }))
      sendPlanData()
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

            // Web-specific commands
            if (cmd === 'help') {
              ws.send(
                JSON.stringify({
                  type: 'help',
                  commands: [
                    '/mode <code|plan|ask|loop|review> - Switch mode',
                    '/model <name> - Switch model',
                    '/compact - Compress context to reduce tokens',
                    '/new - Start a new session',
                    '/stop - Stop the running agent',
                    '/skills - List active skills',
                    '/prompts - List prompt templates',
                    '/init - Create .lonny/skills/ & prompts/',
                    '/help - Show this help',
                  ],
                }),
              )
              return
            }

            if (cmd === 'exit' || cmd === 'quit') {
              ws.close()
              return
            }

            // Web-specific stop (always works, no isRunning check)
            if (cmd === 'stop') {
              sessionWithOutput.stop()
              ws.send(JSON.stringify({ type: 'chunk', text: '\nStopped.\n' }))
              ws.send(JSON.stringify({ type: 'done', reason: 'stop' }))
              return
            }

            // Shared commands via CommandUI
            const ui: CommandUI = {
              write: (text: string) => {
                ws.send(JSON.stringify({ type: 'chunk', text: stripAnsi(text) }))
              },
              replaceContent: () => {
                ws.send(JSON.stringify({ type: 'session_cleared' }))
              },
              onStateChange: () => {},
              onNewSession: (session: Session) => {
                sessionWithOutput = session
                sessionWithOutput.onPlanWritten = (display: string) => {
                  ws.send(JSON.stringify({ type: 'plan_written', display }))
                  sendPlanData()
                }
                if (bridge) bridge.close()
                bridge = startSessionBridge(sessionWithOutput, config, (bridgeMsg: WsMessage) => {
                  if (ws.readyState === ws.OPEN) {
                    ws.send(JSON.stringify(bridgeMsg))
                  }
                })
                pendingConfirm = null
              },
            }
            const handled = await dispatchCommand(
              { session: sessionWithOutput, config, ui, isRunning: false },
              cmd,
              arg,
            )

            if (handled) {
              if (cmd === 'mode') {
                ws.send(JSON.stringify({ type: 'mode_changed', mode: arg }))
              } else if (cmd === 'model') {
                ws.send(JSON.stringify({ type: 'model_changed', model: arg }))
              }
              ws.send(JSON.stringify({ type: 'done', reason: 'stop' }))
              return
            }

            ws.send(JSON.stringify({ type: 'error', message: `Unknown command: ${cmd}` }))
            return
          }

          // Send to session
          try {
            await sessionWithOutput.chat(text)
            // Refresh balance after turn if 5+ min since last fetch
            await fetchAndSendBalance()
            ws.send(JSON.stringify({ type: 'done', reason: 'stop' }))
          } catch (err) {
            const errMsg = fmtErr(err)
            ws.send(JSON.stringify({ type: 'error', message: errMsg }))
            ws.send(JSON.stringify({ type: 'done', reason: 'error' }))
          }
          // Always refresh plan data after a turn (catches plans created via bash/write_plan)
          sendPlanData()
        } else if (msg.type === 'load_plan') {
          const planName = String(msg.planName || '')
          const planEntries = listPlans(config.cwd)
          const { name, todos } = loadPlanTodos(planEntries, planName)
          ws.send(
            JSON.stringify({
              type: 'plan_data',
              plans: planEntries.map(p => ({ name: p.name, mtime: p.mtime })),
              currentPlanName: name,
              todos,
            }),
          )
        } else if (msg.type === 'tool_confirm_response') {
          if (pendingConfirm) {
            pendingConfirm(msg.approved === true)
            pendingConfirm = null
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

    // Fetch DeepSeek balance (non-blocking) and send as balance_update
    ;(async () => {
      try {
        if (isDeepSeekOfficial(config.baseUrl) && config.apiKey) {
          const balance = await fetchDeepSeekBalance(config.apiKey)
          lastBalanceFetch = Date.now()
          if (balance.isAvailable && balance.display) {
            ws.send(
              JSON.stringify({
                type: 'balance_update',
                balance: balance.display,
                webBalance: balance.webDisplay,
              }),
            )
          }
        }
      } catch {
        // Silently ignore balance fetch errors
      }
    })()
    sendPlanData()

    // Send full session history (exclude system prompt, strip ANSI from non-edit tool results)
    const historyMessages = sessionWithOutput.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        if (m.role === 'tool' && typeof m.content === 'string' && m.name !== 'edit') {
          return { ...m, content: stripAnsi(m.content) }
        }
        return m
      })
    console.log(`[Web UI] Sending session_history: ${historyMessages.length} messages `)
    if (historyMessages.length > 0) {
      ws.send(
        JSON.stringify({
          type: 'session_history',
          messages: historyMessages,
        }),
      )
    }
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
