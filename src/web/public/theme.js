  /* ── Theme Manager ── */

  const THEME_KEY = 'lonny-theme'

  export function initTheme() {
    const saved = localStorage.getItem(THEME_KEY)
    const theme = saved || 'dark'
    applyTheme(theme)
  }

  export function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark'
    const next = current === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    localStorage.setItem(THEME_KEY, next)
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme)
  }