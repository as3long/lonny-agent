import type { ToolCall } from '../tools/types.js'

/**
 * Visible width of a string (strip ANSI codes). ASCII=1, CJK/non-ASCII=2.
 * Pure function — no terminal dependency.
 */
export function visibleWidth(s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0x1b) {
      while (i < s.length && s[i] !== 'm') i++
      continue
    }
    w += s.charCodeAt(i) > 0x7e ? 2 : 1
  }
  return w
}

interface SingleEditShape {
  file_path: string
  old_string: string
  new_string: string
}

function isSingleEditShape(v: unknown): v is SingleEditShape {
  return (
    typeof v === 'object' &&
    v !== null &&
    'file_path' in v &&
    'old_string' in v &&
    'new_string' in v
  )
}

/**
 * Format a ToolCall's input into a human-readable summary string.
 * Used by both terminal (session-display) and TUI output.
 */
export function formatToolInput(tc: ToolCall): string {
  const parts: string[] = []
  if (tc.name === 'read' && Array.isArray(tc.input.paths)) {
    parts.push(tc.input.paths.join(', '))
  } else if (tc.name === 'glob' && typeof tc.input.pattern === 'string') {
    parts.push(tc.input.pattern)
  } else if (tc.name === 'grep') {
    if (typeof tc.input.pattern === 'string') parts.push(`/${tc.input.pattern}/`)
    if (typeof tc.input.include === 'string') parts.push(`in:${tc.input.include}`)
  } else if (tc.name === 'ls') {
    parts.push(typeof tc.input.path === 'string' ? tc.input.path : '.')
  } else if (tc.name === 'bash') {
    const cmd = typeof tc.input.command === 'string' ? tc.input.command : ''
    parts.push(cmd.length > 80 ? `${cmd.slice(0, 80)}\u2026` : cmd)
  } else if (tc.name === 'search') {
    if (typeof tc.input.query === 'string') parts.push(tc.input.query.slice(0, 120))
  } else if (tc.name === 'write_plan') {
    if (typeof tc.input.filename === 'string') parts.push(tc.input.filename)
  } else if (tc.name === 'edit') {
    if (Array.isArray(tc.input.edits) && tc.input.edits.every(isSingleEditShape)) {
      const paths = tc.input.edits.map(e => e.file_path)
      parts.push(paths.join(', '))
    }
  }
  return parts.join(' \u2502 ')
}
