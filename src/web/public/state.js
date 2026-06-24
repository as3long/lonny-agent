/* ── DOM References & Shared State ── */

// ── DOM References ──
export const messagesEl = document.getElementById('messages')
export const chatInput = document.getElementById('chat-input')
export const sendBtn = document.getElementById('send-btn')
export const stopBtn = document.getElementById('stop-btn')
export const statusIndicator = document.getElementById('status-indicator')
export const modeDisplay = document.getElementById('mode-display')
export const modelDisplay = document.getElementById('model-display')
export const ctxLabel = document.getElementById('ctx-label')
export const ctxBarFill = document.getElementById('ctx-bar-fill')
export const themeToggle = document.getElementById('theme-toggle')
export const fullscreenBtn = document.getElementById('fullscreen-btn')
export const tokenIn = document.getElementById('token-in')
export const tokenOut = document.getElementById('token-out')
export const tokenCalls = document.getElementById('token-calls')
export const tokenCache = document.getElementById('token-cache')
export const balanceDisplay = document.getElementById('balance-display')
export const balanceSep = document.getElementById('balance-sep')
export const cwdDisplay = document.getElementById('cwd-display')
export const connectionOverlay = document.getElementById('connection-overlay')
export const chatContainer = document.getElementById('chat-container')
export const slashHint = document.getElementById('slash-hint')

// ── New DOM References (Three-Column Layout) ──
export const sidebarLeft = document.getElementById('sidebar-left')
export const fileTree = document.getElementById('file-tree')
export const fileRevealBtn = document.getElementById('file-reveal-btn')
export const resizeHandleLeft = document.getElementById('resize-handle-left')
export const resizeHandleRight = document.getElementById('resize-handle-right')
export const sidebarRight = document.getElementById('sidebar-right')
export const plansPanel = document.getElementById('plans-panel')
export const toolLogPanel = document.getElementById('tool-log-panel')
export const plansContent = document.getElementById('plans-content')
export const toolLogContent = document.getElementById('tool-log-content')
export const plansPlaceholder = document.getElementById('plans-placeholder')
export const plansList = document.getElementById('plans-list')
export const newPlanBtn = document.getElementById('new-plan-btn')
export const plansPagination = document.getElementById('plans-pagination')
export const toolLogClearBtn = document.getElementById('tool-log-clear-btn')

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
  contextWindow: 0,
  // ── File Tree State ──
  fileTreeData: null,
  fileTreeExpanded: new Set(),
  fileTreeActive: '',
  // ── Tool Log State ──
  toolLogEntries: [],
  // ── Theme ──
  theme: 'dark',
  // ── Preview Modal ──
  previewUrl: '',
  previewVisible: false,
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

export function updateState(partial) {
  Object.assign(state, partial)
}
