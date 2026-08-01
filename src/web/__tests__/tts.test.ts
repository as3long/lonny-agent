import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// ── Minimal browser mocks (tts.js runs in the browser only) ──
const storage = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
}

interface MockVoice {
  name: string
  lang: string
  localService: boolean
  default?: boolean
}

const ZH_ONLINE: MockVoice = {
  name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
  lang: 'zh-CN',
  localService: false,
}
const ZH_LOCAL: MockVoice = {
  name: 'Microsoft Huihui - Chinese (Simplified)',
  lang: 'zh-CN',
  localService: true,
}
// Cantonese voices — must NEVER be selected for Chinese text
const HK_ONLINE: MockVoice = {
  name: 'Microsoft Tracy Online (Natural) - Chinese (Hong Kong)',
  lang: 'zh-HK',
  localService: false,
}
const HK_LOCAL: MockVoice = {
  name: 'Microsoft Danny - Chinese (Traditional, Hong Kong)',
  lang: 'zh-HK',
  localService: true,
}
const EN_ONLINE: MockVoice = {
  name: 'Microsoft Aria Online (Natural) - English (United States)',
  lang: 'en-US',
  localService: false,
}
const EN_LOCAL: MockVoice = { name: 'Google US English', lang: 'en-US', localService: true }

let voices: MockVoice[] = []
const spoken: { text: string; voice: MockVoice | null; lang: string; rate: number }[] = []

;(globalThis as any).speechSynthesis = {
  getVoices: () => voices,
  cancel: () => {},
  speak: (u: any) => spoken.push({ text: u.text, voice: u.voice, lang: u.lang, rate: u.rate }),
}
;(globalThis as any).SpeechSynthesisUtterance = class {
  text: string
  voice: MockVoice | null = null
  lang = ''
  rate = 1
  pitch = 1
  volume = 1
  constructor(text: string) {
    this.text = text
  }
}

function setUserAgent(ua: string) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
  })
}

async function loadTtsModule() {
  vi.resetModules()
  const mod = await import('../public/tts.js')
  return mod
}

describe('tts.js — voice picking', () => {
  beforeEach(() => {
    storage.clear()
    storage.set('lonny-tts-enabled', '1') // TTS on
    // Cantonese voices first on purpose — Windows/Edge often lists them before Mandarin
    voices = [HK_LOCAL, HK_ONLINE, ZH_ONLINE, ZH_LOCAL, EN_ONLINE, EN_LOCAL]
    spoken.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Edge UA: prefers Microsoft neural online voice for Chinese text', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const tts = await loadTtsModule()
    tts.speak('你好，这是语音播报测试')
    expect(spoken).toHaveLength(1)
    expect(spoken[0].voice?.name).toContain('Xiaoxiao Online')
  })

  test('Edge UA: prefers Microsoft neural online voice for English text', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const tts = await loadTtsModule()
    tts.speak('Hello, this is a voice test')
    expect(spoken[0].voice?.name).toContain('Aria Online')
  })

  test('Non-Edge (Chrome) UA: prefers local service voice', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    const tts = await loadTtsModule()
    tts.speak('你好，这是语音播报测试')
    expect(spoken[0].voice?.name).toBe(ZH_LOCAL.name)
  })

  test('TTS disabled: speak() is a silent no-op', async () => {
    storage.set('lonny-tts-enabled', '0')
    const tts = await loadTtsModule()
    tts.speak('should not be spoken')
    expect(spoken).toHaveLength(0)
  })

  test('stripMarkdown: code blocks and markdown syntax are not spoken', async () => {
    const tts = await loadTtsModule()
    tts.speak('```js\nconst x = 1\n```\n这是**加粗**的[链接](https://example.com)')
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('这是加粗的链接')
  })

  test('stripMarkdown: emoji are filtered out of spoken text', async () => {
    const tts = await loadTtsModule()
    tts.speak('🔊 完成 ✅ 天气 ☀️ 晴天 🌧️ 下雨 ⚠️ 注意！')
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('完成 天气 晴天 下雨 注意！')
  })

  test('stripMarkdown: emoji with skin tone modifiers and ZWJ sequences are removed', async () => {
    const tts = await loadTtsModule()
    tts.speak('👍🏽 点赞 👨‍👩‍👧 家庭 👩‍💻 程序员 ❤️ 爱心')
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('点赞 家庭 程序员 爱心')
  })

  test('speech rate is 1.5x', async () => {
    const tts = await loadTtsModule()
    tts.speak('你好，这是语速测试')
    expect(spoken).toHaveLength(1)
    expect((spoken[0] as any).rate).toBe(1.5)
  })

  test('empty voice list: falls back gracefully to language tag only', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    voices = []
    const tts = await loadTtsModule()
    tts.speak('你好')
    expect(spoken).toHaveLength(1)
    expect(spoken[0].voice).toBeNull()
    expect(spoken[0].lang).toBe('zh-CN')
  })

  test('Edge: Cantonese (zh-HK) voices listed first are never chosen — Mandarin online wins', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const tts = await loadTtsModule()
    tts.speak('你好，这是语音播报测试')
    expect(spoken[0].voice?.name).toContain('Xiaoxiao')
    expect(spoken[0].voice?.lang.toLowerCase()).not.toContain('zh-hk')
  })

  test('Non-Edge: Cantonese (zh-HK) voices listed first are never chosen — Mandarin local wins', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    const tts = await loadTtsModule()
    tts.speak('你好，这是语音播报测试')
    expect(spoken[0].voice?.name).toContain('Huihui')
    expect(spoken[0].voice?.lang.toLowerCase()).not.toContain('zh-hk')
  })

  test('only Cantonese voices available: falls back to Mandarin language tag, never speaks Cantonese', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    voices = [HK_LOCAL, HK_ONLINE]
    const tts = await loadTtsModule()
    tts.speak('你好，这是语音播报测试')
    expect(spoken[0].voice).toBeNull()
    expect(spoken[0].lang).toBe('zh-CN')
  })

  // ── queue/flush: defer speech until the agent finishes ──

  test('queueForSpeaking buffers text without speaking immediately', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const tts = await loadTtsModule()
    tts.queueForSpeaking('第一轮输出')
    tts.queueForSpeaking('第二轮输出')
    expect(spoken).toHaveLength(0)
  })

  test('flushSpeaking speaks the buffered messages once, joined as one utterance', async () => {
    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    )
    const tts = await loadTtsModule()
    tts.queueForSpeaking('第一轮输出')
    tts.queueForSpeaking('第二轮输出')
    tts.flushSpeaking()
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('第一轮输出。第二轮输出')
    expect(spoken[0].voice?.name).toContain('Xiaoxiao')
  })

  test('queue keeps only the last 2 messages — older ones are dropped', async () => {
    const tts = await loadTtsModule()
    tts.queueForSpeaking('第一条')
    tts.queueForSpeaking('第二条')
    tts.queueForSpeaking('第三条')
    tts.flushSpeaking()
    expect(spoken).toHaveLength(1)
    expect(spoken[0].text).toBe('第二条。第三条')
  })

  test('flushSpeaking with an empty queue is a no-op', async () => {
    const tts = await loadTtsModule()
    tts.flushSpeaking()
    expect(spoken).toHaveLength(0)
  })

  test('queue/flush respect the TTS enable flag', async () => {
    storage.set('lonny-tts-enabled', '0')
    const tts = await loadTtsModule()
    tts.queueForSpeaking('不会朗读')
    tts.flushSpeaking()
    expect(spoken).toHaveLength(0)
  })

  test('cancelTTS clears the pending queue', async () => {
    const tts = await loadTtsModule()
    tts.queueForSpeaking('第一条')
    tts.cancelTTS()
    tts.flushSpeaking()
    expect(spoken).toHaveLength(0)
  })
})
