/* ── Entry Point ── */

import { initInput } from './input.js'
import { connect } from './websocket.js'
import { initTheme, toggleTheme } from './theme.js'
import {
  fullscreenBtn,
  resizeHandleLeft,
  resizeHandleRight,
  themeToggle,
} from './state.js'
import { initPlanFilters, initNewPlan, initClearLog } from './sidebar.js'
import { initFileTree } from './file-tree.js'

// ── Resize Handle Drag Logic ──

function initResizeHandle(handle, cssVar, min, max) {
  let isDragging = false
  let startX = 0
  let startSize = 0

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault()
    isDragging = true
    startX = e.clientX
    startSize = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar)) || min

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  })

  function onMouseMove(e) {
    if (!isDragging) return
    const delta = e.clientX - startX
    const newSize = Math.max(min, Math.min(max, startSize + delta))
    document.documentElement.style.setProperty(cssVar, `${newSize}px`)
  }

  function onMouseUp() {
    isDragging = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
}

// ── Initialize ──

initTheme()
connect()
initInput()
  initPlanFilters()
  initNewPlan()
  initClearLog()
  initFileTree()

// ── Sidebars: Resize ──
initResizeHandle(resizeHandleLeft, '--sidebar-left-width', 180, 320)
initResizeHandle(resizeHandleRight, '--sidebar-right-width', 260, 420)

// ── Theme Toggle ──
themeToggle.addEventListener('click', toggleTheme)

// ── Fullscreen ──
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
    fullscreenBtn.textContent = '⛶'
  } else {
    document.exitFullscreen()
    fullscreenBtn.textContent = '□'
  }
})
document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = document.fullscreenElement ? '⛶' : '□'
})
