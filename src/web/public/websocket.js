/* ── WebSocket Connection & Message Handler ── */

import { closeConfirmDialog, showConfirmDialog } from './confirm.js'
import {
  addErrorMessage,
  addSystemMessage,
  addTokenStats,
  addToolCall,
  addToolResult,
  appendChunk,
  finalizeAssistantMessage,
  hideThinking,
  renderSessionHistory,
  showThinking,
  startAssistantMessage,
} from './messages.js'
import { updatePlansAndTodos } from './sidebar.js'
import {
  balanceDisplay,
  balanceSep,
  connectionOverlay,
  cwdDisplay,
  MAX_RECONNECT_ATTEMPTS,
  messagesEl,
  modeDisplay,
  modelDisplay,
  pendingToolCalls,
  RECONNECT_DELAY,
  setStatus,
  state,
  tokenCache,
  tokenCalls,
  tokenIn,
  tokenOut,
} from './state.js'
import { formatTokenCount, getWsUrl, scrollToBottom } from './utils.js'
import { setWs } from './ws.js'

function handleMessage(msg) {
  switch (msg.type) {
    case 'hello':
      state.currentMode = msg.mode || 'code'
      state.currentModel = msg.model || ''
      state.currentProvider = msg.provider || ''
      modeDisplay.textContent = state.currentMode
      modelDisplay.textContent = `${state.currentProvider}/${state.currentModel}`
      if (msg.totalIn !== undefined) {
        tokenIn.textContent = formatTokenCount(msg.totalIn || 0)
        tokenOut.textContent = formatTokenCount(msg.totalOut || 0)
        tokenCalls.textContent = `(${msg.totalApi || 0})`
        const cacheHit = msg.totalCacheHit ?? 0
        const cacheMiss = msg.totalCacheMiss ?? 0
        const cacheTotal = cacheHit + cacheMiss
        if (cacheTotal > 0) {
          const pct = Math.round((cacheHit / cacheTotal) * 100)
          tokenCache.textContent = `| 缓存 ${pct}%`
          tokenCache.classList.remove('hidden')
        }
      }
      if (msg.webBalance) {
        balanceDisplay.textContent = `余额：${msg.webBalance}`
        balanceDisplay.style.display = ''
        balanceSep.style.display = ''
      } else if (msg.balance) {
        balanceDisplay.textContent = `余额：${msg.balance}`
        balanceDisplay.style.display = ''
        balanceSep.style.display = ''
      } else {
        balanceDisplay.style.display = 'none'
        balanceSep.style.display = 'none'
      }
      if (msg.cwd) {
        const maxLen = 35
        cwdDisplay.textContent = msg.cwd.length > maxLen ? `...${msg.cwd.slice(-maxLen)}` : msg.cwd
      }
      break

    case 'chunk':
      appendChunk(msg.text || '')
      break

    case 'thinking':
      showThinking(msg.text || '')
      break

    case 'thinking_end':
      hideThinking()
      break

    case 'tool_call':
      addToolCall(msg.name, msg.input, msg.id)
      break

    case 'tool_result':
      if (msg.success) {
        addToolResult(msg.name, true, msg.output || '', msg.id)
      } else {
        addToolResult(msg.name, false, msg.error || 'Unknown error', msg.id)
      }
      break

    case 'turn_start':
      setStatus(true)
      startAssistantMessage()
      break

    case 'turn_end':
      hideThinking()
      for (const [, el] of pendingToolCalls) el.classList.remove('executing')
      pendingToolCalls.clear()
      finalizeAssistantMessage()
      break

    case 'done':
      setStatus(false)
      hideThinking()
      for (const [, el] of pendingToolCalls) el.classList.remove('executing')
      pendingToolCalls.clear()
      finalizeAssistantMessage()
      if (msg.reason === 'error') {
        addErrorMessage('An error occurred during processing.')
      }
      break

    case 'mode_changed':
      state.currentMode = msg.mode
      modeDisplay.textContent = state.currentMode
      addSystemMessage(`Switched to ${state.currentMode} mode`)
      break

    case 'model_changed':
      state.currentModel = msg.model
      modelDisplay.textContent = `${state.currentProvider}/${state.currentModel}`
      addSystemMessage(`Model switched to ${state.currentModel}`)
      break

    case 'session_cleared':
      messagesEl.innerHTML = ''
      addSystemMessage('Session cleared. Starting fresh.')
      break

    case 'help':
      if (Array.isArray(msg.commands)) {
        addSystemMessage('Available commands:')
        msg.commands.forEach(cmd => addSystemMessage(cmd))
      }
      break

    case 'compaction':
      addSystemMessage(`📦 Compressed context: ${msg.before} → ${msg.after} messages`)
      break

    case 'plan_written':
      addSystemMessage(`📝 Plan written: ${msg.display || ''}`)
      break

    case 'session_history':
      renderSessionHistory(msg.messages)
      setTimeout(scrollToBottom, 50)
      break

    case 'plan_data':
      state.plans = msg.plans || []
      state.currentPlanName = msg.currentPlanName || ''
      state.todos = msg.todos || []
      updatePlansAndTodos()
      break

    case 'balance_update':
      if (msg.webBalance) {
        balanceDisplay.textContent = `余额：${msg.webBalance}`
        balanceDisplay.style.display = ''
        balanceSep.style.display = ''
      } else if (msg.balance) {
        balanceDisplay.textContent = `余额：${msg.balance}`
        balanceDisplay.style.display = ''
        balanceSep.style.display = ''
      }
      break

    case 'token_stats':
      addTokenStats(
        msg.turnIn,
        msg.turnOut,
        msg.totalIn,
        msg.totalOut,
        msg.turnApi,
        msg.totalApi,
        msg.totalCacheHit,
        msg.totalCacheMiss,
      )
      break

    case 'tool_confirm_request': {
      if (!msg.toolCalls || msg.toolCalls.length === 0) break
      showConfirmDialog(msg.toolCalls)
      break
    }

    case 'error':
      closeConfirmDialog()
      addErrorMessage(msg.message || 'Unknown error')
      break

    case 'pong':
      break

    default:
      console.log('Unknown message type:', msg.type)
  }
}

export function connect() {
  connectionOverlay.classList.remove('hidden')

  let ws
  try {
    ws = new WebSocket(getWsUrl())
    setWs(ws)
  } catch (err) {
    connectionOverlay.classList.add('hidden')
    addErrorMessage(`Connection failed: ${err.message}`)
    return
  }

  ws.onopen = () => {
    connectionOverlay.classList.add('hidden')
    state.reconnectAttempts = 0
    addSystemMessage('Connected to Lonny')
  }

  ws.onmessage = event => {
    try {
      const msg = JSON.parse(event.data)
      handleMessage(msg)
    } catch (err) {
      console.error('Failed to parse message:', err)
    }
  }

  ws.onclose = () => {
    setStatus(false)
    hideThinking()
    for (const [, el] of pendingToolCalls) el.classList.remove('executing')
    pendingToolCalls.clear()
    if (state.streamingMsgEl) {
      finalizeAssistantMessage()
    }

    if (state.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      state.reconnectAttempts++
      const delay = RECONNECT_DELAY * Math.min(state.reconnectAttempts, 5)
      connectionOverlay.querySelector('p').textContent =
        `Reconnecting in ${delay / 1000}s... (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
      connectionOverlay.classList.remove('hidden')
      setTimeout(connect, delay)
    } else {
      connectionOverlay.querySelector('p').textContent = 'Connection lost. Please refresh the page.'
      connectionOverlay.classList.remove('hidden')
      addErrorMessage('Connection lost. Refresh the page to reconnect.')
    }
  }

  ws.onerror = () => {
    // onclose will fire after this
  }
}
