/* ── Message Rendering ── */

import { openPreview } from './preview-modal.js'
import {
  messagesEl,
  pendingToolCalls,
  state,
  tokenCache,
  tokenCalls,
  tokenIn,
  tokenOut,
  updateState,
} from './state.js'
import {
  escapeHtml,
  formatTimestamp,
  formatTokenCount,
  renderMarkdown,
  scrollToBottom,
} from './utils.js'

// ── Tool Icons (inline SVG) ──
const TOOL_ICONS = {
  read: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  glob: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 10a4 4 0 0 1 8 0c0 2.5-2 5-4 7-2-2-4-4.5-4-7z"/><circle cx="10" cy="10" r="8"/><line x1="2" y1="2" x2="6" y2="6"/></svg>',
  grep: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  bash: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  write_plan:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',
  fetch:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  delete:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
}
function getToolIcon(name) {
  return TOOL_ICONS[name] || TOOL_ICONS.read
}
function getToolColor(name) {
  const map = {
    read: 'tool-name-read',
    glob: 'tool-name-glob',
    grep: 'tool-name-grep',
    edit: 'tool-name-edit',
    bash: 'tool-name-bash',
    write_plan: 'tool-name-write',
    fetch: 'tool-name-fetch',
    delete: 'tool-name-delete',
  }
  return map[name] || ''
}

// ── Helper: wrap message with hover actions ──
function wrapWithHover(el, actions) {
  const wrap = document.createElement('div')
  wrap.className = 'msg-hover-wrap'
  const actionsDiv = document.createElement('div')
  actionsDiv.className = 'msg-hover-actions'
  for (const a of actions) {
    const btn = document.createElement('button')
    btn.className = 'msg-hover-btn'
    btn.innerHTML = a.icon || a.label
    btn.title = a.title || ''
    btn.addEventListener('click', a.onClick)
    actionsDiv.appendChild(btn)
  }
  wrap.appendChild(el)
  wrap.appendChild(actionsDiv)
  return wrap
}

export function addSystemMessage(text) {
  const div = document.createElement('div')
  div.className = 'system-message'
  div.textContent = text
  messagesEl.appendChild(div)
  scrollToBottom()
}

export function addUserMessage(text) {
  console.log('[msg] addUserMessage called:', {
    textLen: text?.length,
    messagesElExists: !!messagesEl,
  })
  try {
    const msgDiv = document.createElement('div')
    msgDiv.className = 'message user'

    const rendered = renderMarkdown(text || '')
    msgDiv.innerHTML = `
      <div class="message-header">
        <span class="avatar">Y</span>
        <span class="label user">You</span>
        <span class="timestamp">${formatTimestamp()}</span>
      </div>
      <div class="message-body user">${rendered}</div>
    `

    // Wrap with hover actions
    const body = msgDiv.querySelector('.message-body')
    if (body) {
      // Save reference before wrapWithHover moves body out of msgDiv
      const nextSibling = body.nextSibling
      const hoverWrap = wrapWithHover(body, [
        {
          icon: '📋',
          title: 'Copy',
          onClick() {
            navigator.clipboard.writeText(text)
          },
        },
        {
          icon: '↻',
          title: 'Resend',
          onClick() {
            document.getElementById('chat-input').value = text
            document.getElementById('chat-input').focus()
          },
        },
      ])
      msgDiv.insertBefore(hoverWrap, nextSibling)
    }

    messagesEl.appendChild(msgDiv)
    scrollToBottom()
  } catch (err) {
    console.error('[addUserMessage] Error:', err)
    // Fallback: try simple approach
    try {
      const fallback = document.createElement('div')
      fallback.className = 'message user'
      fallback.textContent = text
      messagesEl.appendChild(fallback)
    } catch {}
  }
}

export function startAssistantMessage() {
  state.streamingText = ''
  state.streamingMsgEl = document.createElement('div')
  state.streamingMsgEl.className = 'message'

  state.streamingMsgEl.innerHTML = `
    <div class="message-header">
      <span class="avatar">L</span>
      <span class="label assistant">Lonny</span>
      <span class="timestamp">${formatTimestamp()}</span>
    </div>
    <div class="message-body assistant streaming"></div>
  `

  messagesEl.appendChild(state.streamingMsgEl)
  scrollToBottom()
}

export function appendChunk(text) {
  if (!state.streamingMsgEl) {
    startAssistantMessage()
  }
  state.streamingText += text
  const body = state.streamingMsgEl.querySelector('.message-body')
  body.innerHTML = renderMarkdown(state.streamingText)
  body.classList.add('streaming')
  scrollToBottom()
}

export function finalizeAssistantMessage() {
  if (!state.streamingMsgEl) return
  const body = state.streamingMsgEl.querySelector('.message-body')
  body.innerHTML = renderMarkdown(state.streamingText)
  body.classList.remove('streaming')
  state.streamingMsgEl = null
  state.streamingText = ''
  scrollToBottom()
}

export function addToolCall(name, input, id) {
  const container = state.streamingMsgEl || messagesEl.querySelector('.message:last-child')
  const div = document.createElement('div')
  div.className = `tool-call${id ? ' executing' : ''}`
  div.dataset.toolId = id || ''

  const icon = getToolIcon(name)
  const colorClass = getToolColor(name)

  const inputStr = typeof input === 'object' ? JSON.stringify(input).slice(0, 120) : String(input)
  div.innerHTML = `
    <span class="tool-icon">${icon}</span>
    <span class="tool-name ${colorClass}">${escapeHtml(name)}</span>
    <span class="tool-input">${escapeHtml(inputStr)}</span>
    <span class="tool-status" id="tool-status-${id || ''}"></span>
    <button class="tool-collapse-btn" onclick="this.parentElement.classList.toggle('collapsed')">&#9660;</button>
  `

  if (container && container.matches('.message')) {
    container.appendChild(div)
  } else {
    messagesEl.appendChild(div)
  }
  if (id) pendingToolCalls.set(id, div)
  scrollToBottom()
}

const DIFF_RED = '#ff5050'
const DIFF_GREEN = '#00c864'
const DIFF_DIM = '#888888'

const ANSI_RED = '\x1b[38;2;255;80;80m'
const ANSI_GREEN = '\x1b[38;2;0;200;100m'
const ANSI_DIM = '\x1b[38;2;100;100;100m'
const ANSI_PATTERN = /\x1b\[[\d;]+m/g

function renderDiffContent(text) {
  const hasAnsi = text.includes(ANSI_RED) || text.includes(ANSI_GREEN) || text.includes(ANSI_DIM)

  if (hasAnsi) {
    return text
      .split('\n')
      .map(line => {
        if (!line.trim()) return `${escapeHtml(line)}\n`
        const color = line.includes(ANSI_RED)
          ? DIFF_RED
          : line.includes(ANSI_GREEN)
            ? DIFF_GREEN
            : line.includes(ANSI_DIM)
              ? DIFF_DIM
              : null
        const clean = line.replace(ANSI_PATTERN, '')
        if (!color) return `${escapeHtml(clean)}\n`
        return `<span style="color:${color}">${escapeHtml(clean)}\n</span>`
      })
      .join('')
  }

  // Fallback: detect unified-diff markers (- / +) without ANSI codes
  const hasDiffMarkers = text.split('\n').some(l => l.trim().match(/^[-+]\s/))
  if (hasDiffMarkers) {
    return text
      .split('\n')
      .map(line => {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ')) {
          return `<span style="color:${DIFF_RED}">${escapeHtml(line)}\n</span>`
        }
        if (trimmed.startsWith('+ ')) {
          return `<span style="color:${DIFF_GREEN}">${escapeHtml(line)}\n</span>`
        }
        if (trimmed.match(/^[-+]\s/)) {
          return `<span style="color:${DIFF_DIM}">${escapeHtml(line)}\n</span>`
        }
        return `${escapeHtml(line)}\n`
      })
      .join('')
  }

  return escapeHtml(text)
}

export function addToolResult(name, success, outputOrError, id) {
  // ── Update pending tool call status ──
  if (id) {
    const pendingEl = pendingToolCalls.get(id)
    if (pendingEl) {
      pendingEl.classList.remove('executing')
      pendingToolCalls.delete(id)
      pendingEl.classList.add(success ? 'completed' : 'failed')
      const statusEl = pendingEl.querySelector('.tool-status')
      if (statusEl) {
        statusEl.innerHTML = success
          ? '<span class="status-success">✔</span>'
          : '<span class="status-error">✖</span>'
      }
    }
  }

  const container = state.streamingMsgEl || messagesEl.querySelector('.message:last-child')
  const div = document.createElement('div')
  div.className = 'tool-result'

  const display = (outputOrError || '').replace(/\s+$/, '')
  const totalLines = display ? display.split('\n').length : 0
  const maxPreviewLines = 20
  const isTruncated = totalLines > maxPreviewLines

  // ── Header row ──
  const header = document.createElement('div')
  header.className = 'tool-result-header'
  if (success) {
    header.innerHTML = `<span class="tool-result-status success">✔ ${escapeHtml(name)}</span>`
  } else {
    header.innerHTML = `<span class="tool-result-status error">✖ ${escapeHtml(name)}</span>`
  }

  // ── Preview content (truncated) ──
  if (display) {
    const preview = document.createElement('div')
    preview.className = 'tool-result-preview'

    if (name === 'edit' && success && display) {
      // Show diff-style content
      const diffHtml = renderDiffContent(display)
      preview.innerHTML = `<pre><code>${diffHtml}</code></pre>`
    } else {
      const lines = display.split('\n')
      const truncated = lines.slice(0, maxPreviewLines)
      preview.textContent = truncated.join('\n')
      if (isTruncated) {
        const info = document.createElement('div')
        info.className = 'tool-result-truncated'
        info.textContent = `… Showing ${maxPreviewLines}/${totalLines} lines`
        preview.appendChild(info)
      }
    }

    div.appendChild(header)
    div.appendChild(preview)

    // ── "View Full File" button ──
    if (isTruncated || name === 'read' || name === 'grep') {
      const viewBtn = document.createElement('button')
      viewBtn.className = 'tool-result-view-btn'
      viewBtn.textContent = '📄 View Full Content'
      viewBtn.addEventListener('click', () => {
        openPreview(
          display,
          name === 'edit'
            ? `${name} result`
            : `${name}: ${outputOrError.split('\n')[0].slice(0, 60)}`,
        )
      })
      div.appendChild(viewBtn)
    }
  } else {
    div.appendChild(header)
  }

  if (container && container.matches('.message')) {
    container.appendChild(div)
  } else {
    messagesEl.appendChild(div)
  }
  scrollToBottom()
}

export function showThinking(text) {
  if (!state.thinkingEl) {
    state.thinkingEl = document.createElement('div')
    state.thinkingEl.className = 'thinking-block collapsed'
    state.thinkingEl.innerHTML = `
      <div class="thinking-header" onclick="this.parentElement.classList.toggle('collapsed');const t=this.querySelector('.thinking-toggle');t.textContent=t.textContent==='▶ 展开推理'?'▼ 收起':'▶ 展开推理'">
        <span class="thinking-icon">🧠</span>
        <span class="thinking-label">AI 推理过程</span>
        <span class="thinking-toggle">▶ 展开推理</span>
      </div>
      <div class="thinking-content"></div>
    `
    if (state.streamingMsgEl) {
      state.streamingMsgEl.appendChild(state.thinkingEl)
    } else {
      messagesEl.appendChild(state.thinkingEl)
    }
    state.thinkingText = ''
  }
  state.thinkingText += text
  const content = state.thinkingEl.querySelector('.thinking-content')
  content.innerHTML = renderMarkdown(state.thinkingText)
  scrollToBottom()
}

export function hideThinking() {
  if (state.thinkingEl) {
    state.thinkingEl.classList.add('thinking-done')
    state.thinkingEl = null
    state.thinkingText = ''
  }
}

export function renderSessionHistory(messages) {
  if (!Array.isArray(messages)) return
  let rendered = 0
  let errors = 0
  for (const msg of messages) {
    try {
      if (msg.role === 'user') {
        addUserMessage(msg.content || '')
      } else if (msg.role === 'assistant') {
        startAssistantMessage()
        if (msg.reasoning_content) {
          showThinking(msg.reasoning_content)
          hideThinking()
        }
        if (msg.content) {
          state.streamingText = msg.content
          const body = state.streamingMsgEl.querySelector('.message-body')
          body.innerHTML = renderMarkdown(msg.content)
        }
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          for (const tc of msg.tool_calls) {
            addToolCall(tc.name, tc.input)
          }
        }
        finalizeAssistantMessage()
      } else if (msg.role === 'tool') {
        const content = msg.content || ''
        const isError = content.startsWith('ERROR: ')
        if (isError) {
          addToolResult(msg.name || '', false, content.replace(/^ERROR:\s*/, ''))
        } else {
          addToolResult(msg.name || '', true, content)
        }
      }
      rendered++
    } catch (err) {
      errors++
      console.error(
        `[renderSessionHistory] Error rendering message #${rendered} role=${msg.role}:`,
        err,
      )
    }
  }
  if (errors > 0) {
    console.warn(`[renderSessionHistory] Rendered ${rendered} messages with ${errors} errors`)
  }
}

export function addTokenStats(
  turnIn,
  turnOut,
  totalIn,
  totalOut,
  turnApi,
  totalApi,
  totalCacheHit,
  totalCacheMiss,
) {
  const div = document.createElement('div')
  const cacheHit = totalCacheHit ?? 0
  const cacheMiss = totalCacheMiss ?? 0
  const cacheTotal = cacheHit + cacheMiss
  let statsText = `▴${turnIn} ▾${turnOut}  total ${totalIn + totalOut}  calls ${turnApi}(${totalApi})`
  if (cacheTotal > 0) {
    const pct = Math.round((cacheHit / cacheTotal) * 100)
    statsText += `  cached ${pct}%`
  }
  div.className = 'token-stats-bar'
  div.textContent = statsText
  messagesEl.appendChild(div)
  scrollToBottom()

  tokenIn.textContent = formatTokenCount(totalIn)
  tokenOut.textContent = formatTokenCount(totalOut)
  tokenCalls.textContent = `(${totalApi})`
  if (cacheTotal > 0) {
    const pct = Math.round((cacheHit / cacheTotal) * 100)
    tokenCache.textContent = `| 缓存 ${pct}%`
    tokenCache.classList.remove('hidden')
  } else {
    tokenCache.classList.add('hidden')
  }
}

export function addErrorMessage(text) {
  const div = document.createElement('div')
  div.className = 'message'
  div.innerHTML = `<div class="message-body error">${escapeHtml(text)}</div>`
  messagesEl.appendChild(div)
  scrollToBottom()
}
