/* ── Sidebar (Plans & Tool Log) ── */

import {
  newPlanBtn,
  plansList,
  plansPagination,
  plansPlaceholder,
  state,
  toolLogContent,
} from './state.js'
import { escapeHtml } from './utils.js'
import { sendWsMsg } from './ws.js'

// ── Constants ──
const PAGE_SIZE = 10
let currentFilter = 'active'
let currentPage = 1

// ── Format date ──
function formatDate(mtime) {
  if (!mtime) return ''
  return new Date(mtime).toLocaleDateString() +
    ' ' + new Date(mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Create Plan Card ──
function createPlanCard(plan) {
  const div = document.createElement('div')
  div.className = `plan-card${plan.status === 'completed' ? ' completed' : ''}${plan.status === 'archived' ? ' archived' : ''}${plan.name === state.currentPlanName ? ' active' : ''}`
  div.dataset.planName = plan.name

  const progress = plan.total > 0 ? Math.round((plan.done / plan.total) * 100) : 0
  const progressText = plan.total > 0 ? `${plan.done}/${plan.total} (${progress}%)` : ''

  div.innerHTML = `
    <div class="plan-card-header">
      <span class="plan-icon">📄</span>
      <span class="plan-name">${escapeHtml(plan.name)}</span>
    </div>
    <div class="plan-time">${escapeHtml(formatDate(plan.mtime))}</div>
    ${progressText ? `
    <div class="plan-progress">
      <div class="plan-progress-bar">
        <div class="plan-progress-fill" style="width:${progress}%"></div>
      </div>
      <span class="plan-progress-text">${escapeHtml(progressText)}</span>
    </div>` : ''}
    <div class="plan-actions hidden">
      <button class="plan-action plan-action-edit" title="Edit">✏</button>
      <button class="plan-action plan-action-archive" title="Archive">📦</button>
      <button class="plan-action plan-action-delete" title="Delete">🗑</button>
      <button class="plan-action plan-action-open" title="Open File">📂</button>
    </div>
  `

  // Hover: show actions
  div.addEventListener('mouseenter', () => {
    const actions = div.querySelector('.plan-actions')
    if (actions) actions.classList.remove('hidden')
  })
  div.addEventListener('mouseleave', () => {
    const actions = div.querySelector('.plan-actions')
    if (actions) actions.classList.add('hidden')
  })

  // Click card: load plan
  div.addEventListener('click', (e) => {
    if (e.target.closest('.plan-action')) return
    onPlanClick(plan.name)
  })

  // Action buttons
  div.querySelector('.plan-action-edit')?.addEventListener('click', (e) => {
    e.stopPropagation()
    sendWsMsg({ type: 'load_plan', planName: plan.name })
  })
  div.querySelector('.plan-action-archive')?.addEventListener('click', (e) => {
    e.stopPropagation()
    const ok = confirm(`Archive plan "${plan.name}"?`)
    if (ok) sendWsMsg({ type: 'archive_plan', planName: plan.name })
  })
  div.querySelector('.plan-action-delete')?.addEventListener('click', (e) => {
    e.stopPropagation()
    const ok = confirm(`Delete plan "${plan.name}"?`)
    if (ok) sendWsMsg({ type: 'delete_plan', planName: plan.name })
  })
  div.querySelector('.plan-action-open')?.addEventListener('click', (e) => {
    e.stopPropagation()
    // Open file in the file tree / load content
    const fileName = `.lonny/${plan.name}`
    sendWsMsg({ type: 'load_plan', planName: plan.name })
    if (window.fileTreeApi && window.fileTreeApi.revealFile) {
      window.fileTreeApi.revealFile(fileName)
    }
  })

  return div
}

// ── Update Plans ──
export function updatePlans() {
  const filtered = state.plans.filter(p => {
    if (currentFilter === 'active') return !p.status || p.status === 'active'
    return p.status === currentFilter
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  if (currentPage > totalPages) currentPage = totalPages

  const start = (currentPage - 1) * PAGE_SIZE
  const page = filtered.slice(start, start + PAGE_SIZE)

  plansList.innerHTML = ''
  if (filtered.length === 0) {
    plansPlaceholder.style.display = ''
    plansPlaceholder.textContent = `No ${currentFilter === 'active' ? '' : currentFilter + ' '}plans.`
  } else {
    plansPlaceholder.style.display = 'none'
  }
  for (const plan of page) {
    plansList.appendChild(createPlanCard(plan))
  }

  // Pagination
  renderPagination(totalPages)
}

function renderPagination(totalPages) {
  plansPagination.innerHTML = ''
  if (totalPages <= 1) return

  const prev = document.createElement('button')
  prev.className = 'page-btn' + (currentPage <= 1 ? ' disabled' : '')
  prev.textContent = '‹'
  prev.addEventListener('click', () => { if (currentPage > 1) { currentPage--; updatePlans() } })
  plansPagination.appendChild(prev)

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button')
    btn.className = 'page-btn' + (i === currentPage ? ' active' : '')
    btn.textContent = i
    btn.addEventListener('click', () => { currentPage = i; updatePlans() })
    plansPagination.appendChild(btn)
  }

  const next = document.createElement('button')
  next.className = 'page-btn' + (currentPage >= totalPages ? ' disabled' : '')
  next.textContent = '›'
  next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage++; updatePlans() } })
  plansPagination.appendChild(next)
}

// ── Plan filters ──
export function initPlanFilters() {
  document.querySelectorAll('.plan-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.plan-filter').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentFilter = btn.dataset.filter || 'active'
      currentPage = 1
      updatePlans()
    })
  })
}

// ── New Plan Button ──
export function initNewPlan() {
  newPlanBtn.addEventListener('click', () => {
    const name = prompt('Enter plan name:')
    if (name && name.trim()) {
      sendWsMsg({ type: 'create_plan', name: name.trim() })
    }
  })
}

// ── Plan click ──
export function onPlanClick(planName) {
  sendWsMsg({ type: 'load_plan', planName })
}

// ── Update plans and todos (called from websocket) ──
export function updatePlansAndTodos() {
  updatePlans()
}

// ── Tool Log ──
export function addToolLogEntry(toolName, result, isError) {
  const entry = document.createElement('div')
  entry.className = 'tool-log-entry'
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  entry.innerHTML =
    `<span class="log-time">${escapeHtml(time)}</span>` +
    `<span class="log-tool ${escapeHtml(toolName)}">${escapeHtml(toolName)}</span> ` +
    `<span class="log-result ${isError ? 'err' : 'ok'}">${isError ? '✕' : '✓'}</span>`
  toolLogContent.appendChild(entry)
  toolLogContent.scrollTop = toolLogContent.scrollHeight
}

// ── Clear Tool Log ──
export function initClearLog() {
  const clearBtn = document.getElementById('tool-log-clear-btn')
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      toolLogContent.innerHTML = ''
    })
  }
}
