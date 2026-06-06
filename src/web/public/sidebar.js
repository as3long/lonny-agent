/* ── Sidebar (Plans / Todos) ── */

import {
  plansList,
  plansPane,
  plansPlaceholder,
  sidebarTabs,
  state,
  todosList,
  todosPane,
  todosPlaceholder,
} from './state.js'
import { escapeHtml } from './utils.js'
import { sendWsMsg } from './ws.js'

export function switchTab(tabId) {
  sidebarTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabId)
  })
  plansPane.classList.toggle('active', tabId === 'plans')
  todosPane.classList.toggle('active', tabId === 'todos')
}

export function updatePlans() {
  plansList.innerHTML = ''
  if (state.plans.length === 0) {
    plansPlaceholder.style.display = ''
    return
  }
  plansPlaceholder.style.display = 'none'
  for (const plan of state.plans) {
    const div = document.createElement('div')
    div.className = `plan-item${plan.name === state.currentPlanName ? ' active' : ''}`
    const timeStr = plan.mtime
      ? new Date(plan.mtime).toLocaleDateString() +
        ' ' +
        new Date(plan.mtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : ''
    div.dataset.planName = plan.name
    div.innerHTML = `<div class="plan-name">${escapeHtml(plan.name)}</div><div class="plan-time">${escapeHtml(timeStr)}</div>`
    div.addEventListener('click', () => onPlanClick(plan.name))
    plansList.appendChild(div)
  }
}

export function updateTodos() {
  todosList.innerHTML = ''
  if (!state.currentPlanName) {
    todosPlaceholder.textContent = '(no plan selected)'
    todosPlaceholder.style.display = ''
    return
  }
  if (state.todos.length === 0) {
    todosPlaceholder.textContent = '(no todos)'
    todosPlaceholder.style.display = ''
    return
  }
  todosPlaceholder.style.display = 'none'
  const header = document.createElement('div')
  header.className = 'todo-header-text'
  header.textContent = state.currentPlanName
  todosList.appendChild(header)
  for (const todo of state.todos) {
    const div = document.createElement('div')
    div.className = 'todo-item'
    const done = todo.done
    div.innerHTML =
      `<span class="todo-check ${done ? 'done' : 'pending'}">${done ? '✅' : '⬜'}</span>` +
      `<span class="todo-text ${done ? 'done' : ''}">${escapeHtml(todo.text)}</span>`
    todosList.appendChild(div)
  }
}

export function onPlanClick(planName) {
  sendWsMsg({ type: 'load_plan', planName })
  switchTab('todos')
}

export function updatePlansAndTodos() {
  updatePlans()
  updateTodos()
}
