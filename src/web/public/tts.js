/* ── Browser TTS (Text-to-Speech) ── */

const TTS_KEY = 'lonny-tts-enabled'
const MAX_CHARS = 2000

let enabled = localStorage.getItem(TTS_KEY) === '1'
let cachedVoices = []

export function isTtsEnabled() {
  return enabled
}

export function initTTS() {
  const btn = document.getElementById('tts-toggle')
  if (!btn) return
  updateTtsBtn(btn)
  btn.addEventListener('click', () => {
    enabled = !enabled
    localStorage.setItem(TTS_KEY, enabled ? '1' : '0')
    updateTtsBtn(btn)
    if (!enabled) cancelTTS()
  })
}

function updateTtsBtn(btn) {
  btn.textContent = enabled ? '🔊' : '🔇'
  btn.title = enabled ? 'TTS: On (click to mute)' : 'TTS: Off (click to enable)'
  btn.classList.toggle('tts-on', enabled)
}

/** Strip markdown + emoji so the browser reads clean plain text. */
function stripMarkdown(text) {
  return (
    text
      .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
      .replace(/`([^`]*)`/g, '$1') // inline code
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
      .replace(/^#{1,6}\s+/gm, '') // headings
      .replace(/^>\s?/gm, '') // blockquotes
      .replace(/^\s*[-*+]\s+/gm, '') // bullets
      .replace(/^\s*\d+\.\s+/gm, '') // numbered lists
      .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1') // bold/italic
      // emoji & pictographs (never matches digits or ASCII punctuation)
      .replace(/\p{Extended_Pictographic}/gu, ' ')
      // skin tone modifiers + regional indicators (flags) + ZWJ/variation selectors
      .replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '')
      .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '')
      .replace(/[\u200D\uFE0F]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return []
  cachedVoices = speechSynthesis.getVoices() || []
  return cachedVoices
}

if (typeof speechSynthesis !== 'undefined' && speechSynthesis.onvoiceschanged !== undefined) {
  speechSynthesis.onvoiceschanged = loadVoices
}

function isEdge() {
  return typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent || '')
}

/** Mandarin (Simplified Chinese) voice check — excludes Cantonese (zh-HK) and Traditional (zh-TW/zh-Hant). */
function isMandarinVoice(v) {
  const lang = (v.lang || '').toLowerCase().replace(/_/g, '-')
  if (lang.startsWith('zh-cn') || lang.startsWith('zh-hans')) return true
  if (lang.startsWith('zh-hk') || lang.startsWith('zh-tw') || lang.startsWith('zh-hant'))
    return false
  // Name-level fallback: Windows/Edge sometimes reports zh-HK voices with odd tags.
  if (/hong kong|taiwan|tracy|danny/i.test(v.name || '')) return false
  return true // other zh-* variants (e.g. zh-SG) are acceptable fallbacks
}

function pickVoice(text) {
  // Chrome/Edge can return an empty voice list until the first interaction
  // or until onvoiceschanged fires — re-query if we have nothing cached.
  if (!cachedVoices.length) loadVoices()
  if (!cachedVoices.length) return null
  const isZh = /[\u4e00-\u9fff]/.test(text)
  const langPrefix = isZh ? 'zh' : 'en'

  const langVoices = cachedVoices.filter(v => {
    const lang = (v.lang || '').toLowerCase().replace(/_/g, '-')
    if (!lang.startsWith(langPrefix)) return false
    if (isZh && !isMandarinVoice(v)) return false
    return true
  })
  // Prefer zh-CN / zh-Hans even when Cantonese/Traditional voices appear first
  // in getVoices() — Windows lists voice order arbitrarily.
  const mandarin = langVoices.filter(v => {
    const lang = (v.lang || '').toLowerCase().replace(/_/g, '-')
    return lang.startsWith('zh-cn') || lang.startsWith('zh-hans')
  })
  const preferred = mandarin.length ? mandarin : langVoices

  if (isEdge()) {
    // Edge: prefer Microsoft neural online voices (much better quality)
    return (
      preferred.find(v => !v.localService && /online|natural/i.test(v.name)) ||
      preferred.find(v => !v.localService) || // any cloud voice
      preferred.find(v => v.localService) ||
      preferred[0] ||
      null
    )
  }

  return (
    preferred.find(v => v.localService) ||
    preferred[0] ||
    cachedVoices.find(v => v.default) ||
    cachedVoices[0] ||
    null
  )
}

/** Build and speak a single utterance. Shared by speak() and flushSpeaking(). */
function doSpeak(plain) {
  speechSynthesis.cancel() // avoid overlapping speech
  const utter = new SpeechSynthesisUtterance(plain)
  const voice = pickVoice(plain)
  if (voice) {
    utter.voice = voice
    utter.lang = voice.lang
  } else {
    utter.lang = /[\u4e00-\u9fff]/.test(plain) ? 'zh-CN' : 'en-US'
  }
  utter.rate = 1.5
  utter.pitch = 1
  utter.volume = 1
  speechSynthesis.speak(utter)
}

/** Speak text aloud if TTS is enabled. Silently no-ops when unavailable. */
export function speak(text) {
  if (!enabled || !text) return
  if (typeof speechSynthesis === 'undefined') return
  const plain = stripMarkdown(text).slice(0, MAX_CHARS)
  if (!plain) return
  doSpeak(plain)
}

const QUEUE_LIMIT = 2
let pendingQueue = []

/**
 * Buffer a finished assistant message for later speech. During a long agent
 * run the UI finalizes many intermediate messages — speaking each one would
 * constantly interrupt the audio. Only the last QUEUE_LIMIT messages are kept;
 * older ones are dropped. Call flushSpeaking() once the agent finishes.
 */
export function queueForSpeaking(text) {
  if (!enabled || !text) return
  const plain = stripMarkdown(text).slice(0, MAX_CHARS)
  if (!plain) return
  pendingQueue.push(plain)
  if (pendingQueue.length > QUEUE_LIMIT) {
    pendingQueue.splice(0, pendingQueue.length - QUEUE_LIMIT)
  }
}

/** Speak the buffered messages (last 2) as one utterance, then clear the queue. */
export function flushSpeaking() {
  if (!enabled || !pendingQueue.length) return
  if (typeof speechSynthesis === 'undefined') return
  const text = pendingQueue.join('。')
  pendingQueue = []
  doSpeak(text)
}

export function cancelTTS() {
  pendingQueue = []
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
}
