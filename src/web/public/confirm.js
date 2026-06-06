/* ── Tool Confirm Dialog ── */

import { state } from './state.js'
import { escapeHtml } from './utils.js'
import { sendWsMsg } from './ws.js'

export function showConfirmDialog(toolCalls) {
  const overlay = document.getElementById('confirm-overlay')
  const list = document.getElementById('confirm-tool-list')
  if (!overlay || !list) return
  list.innerHTML = ''
  for (const tc of toolCalls) {
    const detail = tc.input?.file_path || tc.input?.command || tc.input?.package_name || ''
    const item = document.createElement('div')
    item.className = 'confirm-tool-item'
    item.innerHTML =
      `<span class="confirm-tool-name">${escapeHtml(tc.name)}</span>` +
      (detail
        ? ` <span class="confirm-tool-input">${escapeHtml(detail.length > 80 ? `${detail.slice(0, 80)}…` : detail)}</span>`
        : '')
    list.appendChild(item)
  }
  overlay.classList.remove('hidden')

  state.pendingConfirmResolve = null

  function cleanup(approved) {
    overlay.classList.add('hidden')
    allowBtn.removeEventListener('click', onAllow)
    rejectBtn.removeEventListener('click', onReject)
    if (state.pendingConfirmResolve) {
      state.pendingConfirmResolve(approved)
      state.pendingConfirmResolve = null
    }
  }

  const allowBtn = document.getElementById('confirm-allow-btn')
  const rejectBtn = document.getElementById('confirm-reject-btn')
  const onAllow = () => {
    sendWsMsg({ type: 'tool_confirm_response', approved: true })
    cleanup(true)
  }
  const onReject = () => {
    sendWsMsg({ type: 'tool_confirm_response', approved: false })
    cleanup(false)
  }
  allowBtn.addEventListener('click', onAllow)
  rejectBtn.addEventListener('click', onReject)
}

export function closeConfirmDialog() {
  const overlay = document.getElementById('confirm-overlay')
  if (overlay && !overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden')
    if (state.pendingConfirmResolve) {
      state.pendingConfirmResolve(false)
      state.pendingConfirmResolve = null
    }
  }
}

// Click overlay background to close (added once)
const confirmOverlay = document.getElementById('confirm-overlay')
if (confirmOverlay) {
  confirmOverlay.addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      closeConfirmDialog()
    }
  })
}
