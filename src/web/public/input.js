/* ── Input Handling, Event Listeners, Slash Hints ── */

import { addErrorMessage, addUserMessage } from './messages.js'
import { switchTab } from './sidebar.js'
import { chatInput, sendBtn, sidebarTabs, slashHint, state, stopBtn } from './state.js'
import { sendWsMsg } from './ws.js'

function sendMessage() {
  const text = chatInput.value.trim()
  if (!text || state.isRunning) return

  addUserMessage(text)
  chatInput.value = ''

  if (!sendWsMsg({ type: 'message', text })) {
    addErrorMessage('Not connected to server.')
  }
}

function showSlashHint() {
  slashHint.classList.remove('hidden')
  const items = slashHint.querySelectorAll('.slash-hint-item')
  items.forEach((item, i) => {
    item.classList.toggle('selected', i === 0)
  })
}

function hideSlashHint() {
  slashHint.classList.add('hidden')
}

export function initInput() {
  // Send button
  sendBtn.addEventListener('click', sendMessage)

  // Stop button
  stopBtn.addEventListener('click', () => {
    sendWsMsg({ type: 'stop' })
    stopBtn.disabled = true
  })

  // Chat input keyboard
  chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
    if (e.key === 'Tab' && !slashHint.classList.contains('hidden')) {
      e.preventDefault()
      const selected = slashHint.querySelector('.slash-hint-item.selected')
      if (selected) {
        const cmd = selected.dataset.cmd
        chatInput.value = `/${cmd}`
        hideSlashHint()
        chatInput.focus()
      }
    }
    if (e.key === 'Escape') {
      hideSlashHint()
    }
  })

  // Slash hint: click to select
  slashHint.addEventListener('click', e => {
    const item = e.target.closest('.slash-hint-item')
    if (item) {
      const cmd = item.dataset.cmd
      chatInput.value = `/${cmd}`
      hideSlashHint()
      chatInput.focus()
    }
  })

  // Slash hint: hover to change selection
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
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 150)}px`

    const text = chatInput.value
    if (text === '/') {
      showSlashHint()
    } else if (!text.startsWith('/') || text.includes(' ')) {
      hideSlashHint()
    }
  })

  // Sidebar tab switching
  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab)
    })
  })

  // Heartbeat
  setInterval(() => {
    sendWsMsg({ type: 'ping' })
  }, 30000)
}
