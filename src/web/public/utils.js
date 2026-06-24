/* ── Utility Functions ── */

import { chatContainer } from './state.js'

export function getWsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}`
}

export function scrollToBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight
  })
}

export function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function formatTimestamp() {
  return new Date().toLocaleTimeString()
}

export function formatTokenCount(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  return String(n)
}

export function renderMarkdown(text) {
  if (typeof marked !== 'undefined' && marked.parse) {
    // Configure marked with highlight.js once
    if (typeof hljs !== 'undefined' && !marked._highlightConfigured) {
      marked.setOptions({
        highlight: function(code, lang) {
          if (lang && hljs.getLanguage(lang)) {
            return hljs.highlight(code, { language: lang }).value
          }
          return hljs.highlightAuto(code).value
        }
      })
      marked._highlightConfigured = true
    }
    return marked.parse(text, { breaks: true, gfm: true })
  }
  return `<pre>${escapeHtml(text)}</pre>`
}


export function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}
