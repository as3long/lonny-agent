/* ── WebSocket Client for Lonny Web UI ───────────────────────── */

;(() => {
  // ── DOM References ──
  const messagesEl = document.getElementById('messages')
  const chatInput = document.getElementById('chat-input')
  const sendBtn = document.getElementById('send-btn')
  const stopBtn = document.getElementById('stop-btn')
  const statusIndicator = document.getElementById('status-indicator')
  const modeDisplay = document.getElementById('mode-display')
  const modelDisplay = document.getElementById('model-display')
  const tokenIn = document.getElementById('token-in')
  const tokenOut = document.getElementById('token-out')
  const tokenCalls = document.getElementById('token-calls')
  const connectionOverlay = document.getElementById('connection-overlay')
  const chatContainer = document.getElementById('chat-container')

  // ── State ──
  let ws = null
  let isRunning = false
  let currentMode = 'code'
  let currentModel = ''
  let currentProvider = ''
  let streamingMsgEl = null
  let streamingText = ''
  let thinkingEl = null
  let thinkingText = ''
  let reconnectAttempts = 0
  const MAX_RECONNECT_ATTEMPTS = 10
  const RECONNECT_DELAY = 2000

  // ── Utility Functions ──

  function getWsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}`
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer.scrollTop = chatContainer.scrollHeight
    })
  }

  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function formatTimestamp() {
    return new Date().toLocaleTimeString()
  }

  function formatTokenCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'K'
    return String(n)
  }

  function setInputEnabled(enabled) {
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

  function setStatus(running) {
    isRunning = running
    statusIndicator.textContent = running ? '● running' : '○ idle'
    statusIndicator.className = running ? 'status-running' : 'status-idle'
    setInputEnabled(!running)
  }

  function updateStats() {
    // Token stats are updated via messages from the server
  }

  // ── Message Rendering ──

  function addSystemMessage(text) {
    const div = document.createElement('div')
    div.className = 'system-message'
    div.textContent = text
    messagesEl.appendChild(div)
    scrollToBottom()
  }

  function addUserMessage(text) {
    const msgDiv = document.createElement('div')
    msgDiv.className = 'message'

    const header = document.createElement('div')
    header.className = 'message-header'
    header.innerHTML = `<span class="label user">You</span> <span class="timestamp">${formatTimestamp()}</span>`
    msgDiv.appendChild(header)

    const body = document.createElement('div')
    body.className = 'message-body user'
    body.innerHTML = renderMarkdown(text)
    msgDiv.appendChild(body)

    messagesEl.appendChild(msgDiv)
    scrollToBottom()
  }

  function startAssistantMessage() {
    streamingText = ''
    streamingMsgEl = document.createElement('div')
    streamingMsgEl.className = 'message'

    const header = document.createElement('div')
    header.className = 'message-header'
    header.innerHTML = `<span class="label assistant">Lonny</span> <span class="timestamp">${formatTimestamp()}</span>`
    streamingMsgEl.appendChild(header)

    const body = document.createElement('div')
    body.className = 'message-body assistant streaming'
    body.textContent = ''
    streamingMsgEl.appendChild(body)

    messagesEl.appendChild(streamingMsgEl)
    scrollToBottom()
  }

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && marked.parse) {
      return marked.parse(text, { breaks: true, gfm: true })
    }
    return '<pre>' + escapeHtml(text) + '</pre>'
  }

  function appendChunk(text) {
    if (!streamingMsgEl) {
      startAssistantMessage()
    }
    streamingText += text
    const body = streamingMsgEl.querySelector('.message-body')
    body.innerHTML = renderMarkdown(streamingText)
    // Ensure streaming cursor stays visible
    body.classList.add('streaming')
    scrollToBottom()
  }

  function finalizeAssistantMessage() {
    if (!streamingMsgEl) return
    const body = streamingMsgEl.querySelector('.message-body')
    // Re-render final text as markdown
    body.innerHTML = renderMarkdown(streamingText)
    body.classList.remove('streaming')
    streamingMsgEl = null
    streamingText = ''
    scrollToBottom()
  }

  function addToolCall(name, input) {
    // Find the current streaming message, or the last assistant message
    const container = streamingMsgEl || messagesEl.querySelector('.message:last-child')
    const div = document.createElement('div')
    div.className = 'tool-call'
    const inputStr = typeof input === 'object' ? JSON.stringify(input).slice(0, 120) : String(input)
    div.innerHTML = `<span class="tool-name">◇ ${escapeHtml(name)}</span> <span class="tool-input">${escapeHtml(inputStr)}</span>`
    if (container && container.matches('.message')) {
      container.appendChild(div)
    } else {
      messagesEl.appendChild(div)
    }
    scrollToBottom()
  }

  function addToolResult(name, success, outputOrError) {
    // Find the current streaming message, or the last assistant message
    const container = streamingMsgEl || messagesEl.querySelector('.message:last-child')
    const div = document.createElement('div')
    div.className = 'tool-result'
    if (success) {
      const summary = typeof outputOrError === 'string' ? outputOrError.slice(0, 80) : ''
      div.innerHTML = `<span class="tool-result-success">✔ ${escapeHtml(name)}</span>${summary ? ' ' + escapeHtml(summary) : ''}`
    } else {
      div.innerHTML = `<span class="tool-result-error">✖ ${escapeHtml(name)}</span> ${escapeHtml(outputOrError)}`
    }
    if (container && container.matches('.message')) {
      container.appendChild(div)
    } else {
      messagesEl.appendChild(div)
    }
    scrollToBottom()
  }

  function showThinking(text) {
    if (!thinkingEl) {
      thinkingEl = document.createElement('div')
      thinkingEl.className = 'thinking-block'
      thinkingEl.innerHTML =
        '<div class="thinking-label">🤔 Think</div><div class="thinking-content"></div>'
      // Insert inside the streaming message (before .message-body) so it stays
      // within the assistant message flow, not as a separate top-level element.
      if (streamingMsgEl) {
        const body = streamingMsgEl.querySelector('.message-body')
        streamingMsgEl.insertBefore(thinkingEl, body)
      } else {
        messagesEl.appendChild(thinkingEl)
      }
      thinkingText = ''
    }
    thinkingText += text
    const content = thinkingEl.querySelector('.thinking-content')
    content.innerHTML = renderMarkdown(thinkingText)
    scrollToBottom()
  }

  function hideThinking() {
    if (thinkingEl) {
      // Don't remove — keep the thinking content visible in the message flow.
      // Just mark it as finalized and clear the reference so new thinking
      // blocks can be created for subsequent turns.
      thinkingEl.classList.add('thinking-done')
      thinkingEl = null
      thinkingText = ''
    }
  }

  function addTokenStats(turnIn, turnOut, totalIn, totalOut, turnApi, totalApi) {
    const div = document.createElement('div')
    div.className = 'token-stats-bar'
    div.textContent = `▴${turnIn} ▾${turnOut}  total ${totalIn + totalOut}  calls ${turnApi}(${totalApi})`
    messagesEl.appendChild(div)
    scrollToBottom()

    // Update status bar (use formatted values)
    tokenIn.textContent = formatTokenCount(totalIn)
    tokenOut.textContent = formatTokenCount(totalOut)
    tokenCalls.textContent = `(${totalApi})`
  }

  function addErrorMessage(text) {
    const div = document.createElement('div')
    div.className = 'message'
    div.innerHTML = `<div class="message-body error">${escapeHtml(text)}</div>`
    messagesEl.appendChild(div)
    scrollToBottom()
  }

  // ── WebSocket Connection ──

  function connect() {
    connectionOverlay.classList.remove('hidden')

    try {
      ws = new WebSocket(getWsUrl())
    } catch (err) {
      connectionOverlay.classList.add('hidden')
      addErrorMessage(`Connection failed: ${err.message}`)
      return
    }

    ws.onopen = () => {
      connectionOverlay.classList.add('hidden')
      reconnectAttempts = 0
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
      if (streamingMsgEl) {
        finalizeAssistantMessage()
      }

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++
        const delay = RECONNECT_DELAY * Math.min(reconnectAttempts, 5)
        connectionOverlay.querySelector('p').textContent =
          `Reconnecting in ${delay / 1000}s... (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`
        connectionOverlay.classList.remove('hidden')
        setTimeout(connect, delay)
      } else {
        connectionOverlay.querySelector('p').textContent =
          'Connection lost. Please refresh the page.'
        connectionOverlay.classList.remove('hidden')
        addErrorMessage('Connection lost. Refresh the page to reconnect.')
      }
    }

    ws.onerror = () => {
      // onclose will fire after this
    }
  }

  // ── Message Handler ──

  function handleMessage(msg) {
    switch (msg.type) {
      case 'hello':
        currentMode = msg.mode || 'code'
        currentModel = msg.model || ''
        currentProvider = msg.provider || ''
        modeDisplay.textContent = currentMode
        modelDisplay.textContent = `${currentProvider}/${currentModel}`
        // Sync token stats from session (formatted)
        if (msg.totalIn !== undefined) {
          tokenIn.textContent = formatTokenCount(msg.totalIn || 0)
          tokenOut.textContent = formatTokenCount(msg.totalOut || 0)
          tokenCalls.textContent = `(${msg.totalApi || 0})`
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
        // Append tool call inline with the current assistant message
        addToolCall(msg.name, msg.input)
        break

      case 'tool_result':
        if (msg.success) {
          addToolResult(msg.name, true, msg.output || '')
        } else {
          addToolResult(msg.name, false, msg.error || 'Unknown error')
        }
        // After a tool result, the next text chunk should continue in the
        // existing assistant message (don't start a new one)
        break

      case 'turn_start':
        setStatus(true)
        // Start a fresh assistant message container for the upcoming response
        startAssistantMessage()
        break

      case 'turn_end':
        hideThinking()
        // Finalize the current message so the next turn starts a fresh one
        finalizeAssistantMessage()
        break

      case 'done':
        setStatus(false)
        hideThinking()
        finalizeAssistantMessage()
        if (msg.reason === 'error') {
          addErrorMessage('An error occurred during processing.')
        }
        break

      case 'mode_changed':
        currentMode = msg.mode
        modeDisplay.textContent = currentMode
        addSystemMessage(`Switched to ${currentMode} mode`)
        break

      case 'model_changed':
        currentModel = msg.model
        modelDisplay.textContent = `${currentProvider}/${currentModel}`
        addSystemMessage(`Model switched to ${currentModel}`)
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

      case 'token_stats':
        addTokenStats(msg.turnIn, msg.turnOut, msg.totalIn, msg.totalOut, msg.turnApi, msg.totalApi)
        break

      case 'error':
        addErrorMessage(msg.message || 'Unknown error')
        break

      case 'pong':
        // Heartbeat response, ignore
        break

      default:
        console.log('Unknown message type:', msg.type)
    }
  }

  // ── Send Message ──

  function sendMessage() {
    const text = chatInput.value.trim()
    if (!text || isRunning) return

    // Add user message to chat
    addUserMessage(text)
    chatInput.value = ''

    // Send to server
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message', text }))
    } else {
      addErrorMessage('Not connected to server.')
    }
  }

  // ── Event Listeners ──

  sendBtn.addEventListener('click', sendMessage)

  // Stop button
  stopBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }))
    }
    stopBtn.disabled = true
  })

  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    // Tab to select hint item
    if (e.key === 'Tab' && !slashHint.classList.contains('hidden')) {
      e.preventDefault()
      const selected = slashHint.querySelector('.slash-hint-item.selected')
      if (selected) {
        const cmd = selected.dataset.cmd
        chatInput.value = '/' + cmd
        hideSlashHint()
        chatInput.focus()
      }
    }
    if (e.key === 'Escape') {
      hideSlashHint()
    }
  })

  // Slash command hint
  const slashHint = document.getElementById('slash-hint')

  function showSlashHint() {
    slashHint.classList.remove('hidden')
    // Select first item by default
    const items = slashHint.querySelectorAll('.slash-hint-item')
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === 0)
    })
  }

  function hideSlashHint() {
    slashHint.classList.add('hidden')
  }

  // Click to select a hint item
  slashHint.addEventListener('click', e => {
    const item = e.target.closest('.slash-hint-item')
    if (item) {
      const cmd = item.dataset.cmd
      chatInput.value = '/' + cmd
      hideSlashHint()
      chatInput.focus()
    }
  })

  // Hover to change selection
  slashHint.addEventListener('mouseover', e => {
    const item = e.target.closest('.slash-hint-item')
    if (item) {
      slashHint.querySelectorAll('.slash-hint-item').forEach(el => el.classList.remove('selected'))
      item.classList.add('selected')
    }
  })

  // Show/hide hint based on input content
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto'
    chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px'

    const text = chatInput.value
    // Show hint only when the text starts with / and is only the / (no other chars yet)
    if (text === '/') {
      showSlashHint()
    } else if (!text.startsWith('/') || text.includes(' ')) {
      hideSlashHint()
    }
  })

  // ── Heartbeat (keep connection alive) ──
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, 30000)

  // ── Initialize ──
  connect()
})()
