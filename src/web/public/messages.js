/* ── Message Rendering ── */

import {
  messagesEl,
  pendingToolCalls,
  state,
  tokenCache,
  tokenCalls,
  tokenIn,
  tokenOut,
} from './state.js'
import {
  escapeHtml,
  formatTimestamp,
  formatTokenCount,
  renderMarkdown,
  scrollToBottom,
} from './utils.js'

export function addSystemMessage(text) {
  const div = document.createElement('div')
  div.className = 'system-message'
  div.textContent = text
  messagesEl.appendChild(div)
  scrollToBottom()
}

export function addUserMessage(text) {
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

export function startAssistantMessage() {
  state.streamingText = ''
  state.streamingMsgEl = document.createElement('div')
  state.streamingMsgEl.className = 'message'

  const header = document.createElement('div')
  header.className = 'message-header'
  header.innerHTML = `<span class="label assistant">Lonny</span> <span class="timestamp">${formatTimestamp()}</span>`
  state.streamingMsgEl.appendChild(header)

  const body = document.createElement('div')
  body.className = 'message-body assistant streaming'
  body.textContent = ''
  state.streamingMsgEl.appendChild(body)

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
  div.className = id ? 'tool-call executing' : 'tool-call'
  div.dataset.toolId = id || ''

  if (name === 'edit') {
    let paths = []
    if (Array.isArray(input?.edits)) {
      paths = input.edits.map(e => e.file_path).filter(Boolean)
    } else if (input?.content) {
      const content = input.content
      // Parse Markdown edit blocks to extract file paths
      // Use RegExp constructor to avoid backtick issues
      const bt = '\x60'
      const blockRegex = new RegExp(bt + bt + bt + 'edit\\s*([\\s\\S]*?)' + bt + bt + bt, 'gi')
      for (const blockMatch of content.matchAll(blockRegex)) {
        const blockContent = blockMatch[1] || ''
        const fileMatch = blockContent.match(/^file:\s*(.+)$/m)
        if (fileMatch) paths.push(fileMatch[1].trim())
        // Detect create-file blocks (empty/missing old:)
        const oldMatch = blockContent.match(/^old:([\s\S]*?)^new:/m)
        if (!oldMatch || !oldMatch[1].trim()) {
          hasEmptyOld = true
        }
      }
      // Fallback: no edit markers -- try raw file: lines
      if (paths.length === 0) {
        const fileMatch = content.match(/^file:\s*(.+)$/gm)
        if (fileMatch) paths = fileMatch.map(m => m.replace(/^file:\s*/, '').trim())
      }
    }
    const uniquePaths = [...new Set(paths)]
    const pathsStr =
      uniquePaths.length > 0 ? uniquePaths.map(p => escapeHtml(p)).join(', ') : '(no files)'

    // Also check JSON-format edits for create-file detection
    if (!hasEmptyOld && Array.isArray(input?.edits)) {
      hasEmptyOld = input.edits.some(e => e.old_string === '')
    }
    const badge = hasEmptyOld ? 'create' : 'edit'
    div.innerHTML = `<span class="tool-name tool-name-edit">✏ edit</span><span class="tool-change-badge tool-change-${badge}">${badge}</span> <span class="tool-input tool-input-edit">${pathsStr}</span>`
  } else {
    const inputStr = typeof input === 'object' ? JSON.stringify(input).slice(0, 120) : String(input)
    div.innerHTML = `<span class="tool-name">${escapeHtml(name)}</span> <span class="tool-input">${escapeHtml(inputStr)}</span>`
  }

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
  if (id) {
    const pendingEl = pendingToolCalls.get(id)
    if (pendingEl) {
      pendingEl.classList.remove('executing')
      pendingToolCalls.delete(id)
      if (name === 'edit') {
        if (success) {
          pendingEl.classList.add('completed')
          const fileSummary = (outputOrError || '')
            .split('\n')
            .map(l => l.trim())
            .filter(l => /^(Edited|Created|Deleted) /.test(l))
            .join(', ')
          if (fileSummary) {
            const inputSpan = pendingEl.querySelector('.tool-input-edit')
            if (inputSpan) {
              inputSpan.textContent = fileSummary.replace(/:\s*$/, '')
            }
          }
        } else {
          pendingEl.classList.add('failed')
        }
      }
    }
  }

  const container = state.streamingMsgEl || messagesEl.querySelector('.message:last-child')
  const div = document.createElement('div')
  div.className = 'tool-result'
  if (success) {
    let display = outputOrError
    if (display === '(no output)') display = ''
    if (name === 'edit' && display) {
      const lines = display.split('\n')
      const edits = [] // { summary, diffLines[] }
      let currentEdit = null
      for (const line of lines) {
        const trimmed = line.trim()
        const stripped = trimmed.replace(ANSI_PATTERN, '')
        if (
          trimmed.startsWith('Edited ') ||
          trimmed.startsWith('Created ') ||
          trimmed.startsWith('Deleted ')
        ) {
          currentEdit = { summary: trimmed, diffLines: [] }
          edits.push(currentEdit)
        } else if (
          currentEdit &&
          (stripped.startsWith('- ') || stripped.startsWith('+ ') || stripped.match(/^\s*\d+ /))
        ) {
          currentEdit.diffLines.push(line)
        }
      }
      let html = `<span class="tool-result-success">✔ ${escapeHtml(name)}</span>`
      if (edits.length === 0 && display.includes(' FAIL ')) {
        html += `<span class="tool-result-diff"><pre>${escapeHtml(display)}</pre></span>`
      } else {
        for (const edit of edits) {
          html += `<span class="tool-result-summary">${escapeHtml(edit.summary)}</span>`
          if (edit.diffLines.length > 0) {
            html += `<span class="tool-result-diff"><pre><code>${renderDiffContent(edit.diffLines.join('\n'))}</code></pre></span>`
          }
        }
      }
      div.innerHTML = html
    } else {
      const summary = typeof display === 'string' ? display.slice(0, 80) : ''
      div.innerHTML = `<span class="tool-result-success">✔ ${escapeHtml(name)}</span>${summary ? ` ${escapeHtml(summary)}` : ''}`
    }
  } else {
    if (name === 'edit') {
      const filePathPattern = /([\w/.-]+\.[a-z]+)/gi
      const filePaths = [...new Set((outputOrError.match(filePathPattern) || []).slice(0, 5))]
      const summary =
        filePaths.length > 0
          ? `<span class="tool-error-files">${filePaths.map(p => escapeHtml(p)).join(', ')}</span>`
          : ''
      div.innerHTML =
        `<span class="tool-result-error">✖ ${escapeHtml(name)}</span>` +
        summary +
        `<span class="tool-error-detail">${escapeHtml(outputOrError)}</span>`
    } else {
      div.innerHTML = `<span class="tool-result-error">✖ ${escapeHtml(name)}</span> <span class="tool-error-detail">${escapeHtml(outputOrError)}</span>`
    }
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
    state.thinkingEl.className = 'thinking-block'
    state.thinkingEl.innerHTML =
      '<div class="thinking-label">🤔 Think</div><div class="thinking-content"></div>'
    if (state.streamingMsgEl) {
      const body = state.streamingMsgEl.querySelector('.message-body')
      state.streamingMsgEl.insertBefore(state.thinkingEl, body)
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
  for (const msg of messages) {
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
