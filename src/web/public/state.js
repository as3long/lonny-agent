/* ── DOM References & Shared State ── */

// ── DOM References ──
export const messagesEl = document.getElementById('messages')
export const chatInput = document.getElementById('chat-input')
export const sendBtn = document.getElementById('send-btn')
export const stopBtn = document.getElementById('stop-btn')
export const statusIndicator = document.getElementById('status-indicator')
export const modeDisplay = document.getElementById('mode-display')
export const modelDisplay = document.getElementById('model-display')
export const tokenIn = document.getElementById('token-in')
export const tokenOut = document.getElementById('token-out')
export const tokenCalls = document.getElementById('token-calls')
export const tokenCache = document.getElementById('token-cache')
export const balanceDisplay = document.getElementById('balance-display')
export const balanceSep = document.getElementById('balance-sep')
export const cwdDisplay = document.getElementById('cwd-display')
export const connectionOverlay = document.getElementById('connection-overlay')
export const chatContainer = document.getElementById('chat-container')
export const sidebar = document.getElementById('sidebar')
export const sidebarTabs = document.querySelectorAll('.sidebar-tab')
export const plansPane = document.getElementById('plans-pane')
export const todosPane = document.getElementById('todos-pane')
export const plansList = document.getElementById('plans-list')
export const todosList = document.getElementById('todos-list')
export const plansPlaceholder = document.getElementById('plans-placeholder')
export const todosPlaceholder = document.getElementById('todos-placeholder')
export const slashHint = document.getElementById('slash-hint')

// ── Mutable State ──
export const state = {
  isRunning: false,
  currentMode: 'code',
  currentModel: '',
  currentProvider: '',
  streamingMsgEl: null,
  streamingText: '',
  thinkingEl: null,
  thinkingText: '',
  reconnectAttempts: 0,
  plans: [],
  currentPlanName: '',
  todos: [],
  pendingConfirmResolve: null,
}

export const pendingToolCalls = new Map()

export const MAX_RECONNECT_ATTEMPTS = 10
export const RECONNECT_DELAY = 2000

// ── Status Helpers ──

export function setInputEnabled(enabled) {
  chatInput.disabled = !enabled
  sendBtn.disabled = !enabled
  sendBtn.classList.toggle('hidden', !enabled)
  stopBtn.classList.toggle('hidden', enabled)
  if (!enabled) {
    stopBtn.disabled = false
  }
  if (enabled) {
    chatInput.focus()
  }
}

export function setStatus(running) {
  state.isRunning = running
  statusIndicator.textContent = running ? '● running' : '○ idle'
  statusIndicator.className = running ? 'status-running' : 'status-idle'
  setInputEnabled(!running)
}
