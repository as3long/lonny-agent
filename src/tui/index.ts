import * as fs from 'node:fs'
import * as path from 'node:path'
import { Session, SessionOutput } from '../agent/session.js'
import { Config } from '../config/index.js'
import { loadTokenUsage, resetTokenUsage } from '../config/tokens.js'
import { loadSkills, ensureSkillsDir } from '../agent/skills.js'
import { loadPromptTemplates, ensurePromptsDir } from '../agent/prompt-templates.js'
import { PLAN_DIR } from '../tools/write_plan.js'
import type { Component, OverlayHandle } from '@earendil-works/pi-tui'
import { ProcessTerminal, TUI, Box, Text, Editor, Markdown, SelectList, Container, Loader, Spacer, CombinedAutocompleteProvider }
  from '@earendil-works/pi-tui'
import type { SelectItem, SelectListTheme, MarkdownTheme, SlashCommand, EditorTheme } from '@earendil-works/pi-tui'

// ── ANSI Color Helpers ───────────────────────────────────────────────────────

// Re-applies background after every full reset (\x1b[0m) so that foreground
// color resets don't "punch through" the background.
function safeBg(text: string, bg: string): string {
  return `\x1b[${bg}m${text.replace(/\x1b\[0m/g, `\x1b[0m\x1b[${bg}m`)}\x1b[0m`
}

const colors = {
  bgDark: (text: string) => safeBg(text, '48;2;30;30;30'),
  bgDim: (text: string) => safeBg(text, '48;2;25;25;25'),
  headerBg: (text: string) => safeBg(text, '48;2;127;219;255'),
  separator: (text: string) => `\x1b[38;2;60;60;60m${text}\x1b[0m`,
  statusBg: (text: string) => safeBg(text, '48;2;25;25;35'),
  running: (text: string) => `\x1b[38;2;0;255;100m${text}\x1b[0m`,
  idle: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  doneTodo: (text: string) => `\x1b[38;2;100;200;100m${text}\x1b[0m`,
  todo: (text: string) => `\x1b[38;2;150;150;150m${text}\x1b[0m`,
  accent: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  dim: (text: string) => `\x1b[38;2;90;90;90m${text}\x1b[0m`,
  userLabel: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
  assistantLabel: (text: string) => `\x1b[38;2;0;255;150m${text}\x1b[0m`,
  error: (text: string) => `\x1b[38;2;255;80;80m${text}\x1b[0m`,
  success: (text: string) => `\x1b[38;2;0;200;100m${text}\x1b[0m`,
  inputPrompt: (text: string) => `\x1b[38;2;0;170;255m${text}\x1b[0m`,
  warn: (text: string) => `\x1b[38;2;255;200;50m${text}\x1b[0m`,
}

// ── App Version (read from package.json) ─────────────────────────────────

const APP_VERSION: string = (() => {
  try {
    const pkgPath = new URL('../../package.json', import.meta.url)
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    return JSON.parse(raw).version || '0.1.0'
  } catch {
    return '0.1.0'
  }
})()

// ── Pixel font for "lonnycode" logo (5 rows × 5 cols per char) ──────────

const PIXEL_FONT: Record<string, string[]> = {
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  Y: ['█   █', ' █ █ ', '  █  ', '  █  ', '  █  '],
  C: [' ███ ', '█    ', '█    ', '█    ', ' ███ '],
  D: ['███  ', '█  █ ', '█   █', '█  █ ', '███  '],
  E: ['█████', '█    ', '███  ', '█    ', '█████'],
}

const LONNY_CHARS = ['L', 'O', 'N', 'N', 'Y']
const CODE_CHARS = ['C', 'O', 'D', 'E']

const PIXEL_LOGO_WIDTH = 54 // 5 cols × 9 chars + 8 gaps + 2 gap between words

function renderPixelLogo(): string[] {
  const midGray = '\x1b[38;2;160;160;160m'
  const brightWhite = '\x1b[38;2;255;255;255m'
  const reset = '\x1b[0m'
  const lines: string[] = []
  for (let row = 0; row < 5; row++) {
    const lonnyPart = LONNY_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    const codePart = CODE_CHARS.map(ch => PIXEL_FONT[ch][row]).join(' ')
    lines.push(midGray + lonnyPart + '  ' + brightWhite + codePart + reset)
  }
  return lines
}

// ── Landing input colors ────────────────────────────────────────────────

const landingColors = {
  inputBg: '\x1b[48;2;35;35;35m',
  inputBorder: '\x1b[38;2;60;60;60m',
  cyanBar: '\x1b[38;2;0;200;255m',
  placeholderDim: '\x1b[38;2;130;130;130m',
  placeholderQuote: '\x1b[38;2;160;160;160m',
  inputText: '\x1b[38;2;220;220;220m',
  statusBg: '\x1b[48;2;18;18;18m',
  statusText: '\x1b[38;2;110;110;110m',
  statusAccent: '\x1b[38;2;0;170;255m',
  reset: '\x1b[0m',
}

// ── Helpers ──────────────────────────────────────────────────────────────

interface PlanEntry {
  name: string
  description: string
  fullPath: string
  mtime: number
}

function listPlans(cwd: string): PlanEntry[] {
  const planDir = path.resolve(cwd, PLAN_DIR)
  try {
    const files = fs.readdirSync(planDir)
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(planDir, f)
        let mtime = 0
        try { mtime = fs.statSync(fullPath).mtimeMs } catch { /* ignore */ }
        return {
          name: f.replace(/\.md$/, ''),
          description: f,
          fullPath,
          mtime,
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
}

function loadTodos(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const todos: string[] = []
    let inTodo = false
    for (const line of lines) {
      if (line.startsWith('## Todo List')) { inTodo = true; continue }
      if (inTodo && line.startsWith('## ')) break
      if (inTodo) {
        const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
        if (m) {
          const done = m[1] === 'x'
          const check = done ? '\u2705' : '\u2B1C'
          todos.push(`${check} ${done ? colors.doneTodo(m[2]) : colors.todo(m[2])}`)
        }
      }
    }
    return todos.length > 0 ? todos.join('\n') : '(no todo items)'
  } catch {
    return '(no plan selected)'
  }
}

function plansToItems(plans: PlanEntry[]): SelectItem[] {
  return plans.map(p => ({ 
    value: p.name, 
    label: p.name, 
    description: p.mtime 
      ? `${new Date(p.mtime).toLocaleDateString()} ${new Date(p.mtime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` 
      : '' 
  }))
}

// ── Inline Syntax Highlighting for Code Blocks ──────────────────────────

// Token colors for syntax highlighting (common language patterns)
const syntaxColors: Record<string, string> = {
  keyword: '\x1b[38;2;197;134;192m',   // purple — keywords
  string: '\x1b[38;2;152;195;121m',    // green — strings
  number: '\x1b[38;2;209;154;102m',    // orange — numbers
  comment: '\x1b[38;2;90;90;90m',     // gray — comments
  builtin: '\x1b[38;2;86;156;214m',    // blue — built-in functions/types
  property: '\x1b[38;2;156;220;254m',  // light blue — properties
  punctuation: '\x1b[38;2;180;180;180m', // light gray — punctuation
  operator: '\x1b[38;2;180;180;180m',  // light gray — operators
  tag: '\x1b[38;2;86;156;214m',       // blue — HTML/JSX tags
  attr: '\x1b[38;2;152;195;121m',     // green — HTML attributes
  variable: '\x1b[38;2;156;220;254m',  // light blue — variables/identifiers
  reset: '\x1b[0m',
}

// Simplified regex-based syntax highlighter for common languages
function highlightLine(line: string, lang: string): string {
  if (!lang) return line

  const langId = lang.toLowerCase().trim()

  // Language-specific highlighting
  if (['ts', 'typescript', 'js', 'javascript', 'jsx', 'tsx'].includes(langId)) {
    return highlightTSLine(line)
  }
  if (['json', 'jsonc'].includes(langId)) {
    return highlightJSONLine(line)
  }
  if (['html', 'xml', 'svg'].includes(langId)) {
    return highlightHTMLLine(line)
  }
  if (['css', 'scss', 'less'].includes(langId)) {
    return highlightCSSLine(line)
  }
  if (['sh', 'bash', 'shell', 'zsh', 'powershell', 'cmd'].includes(langId)) {
    return highlightShellLine(line)
  }
  if (['py', 'python'].includes(langId)) {
    return highlightPythonLine(line)
  }
  if (['rust', 'rs'].includes(langId)) {
    return highlightTSLine(line) // Rust syntax is similar to TS for basic tokens
  }
  if (['go', 'golang'].includes(langId)) {
    return highlightTSLine(line) // Go syntax is similar enough
  }
  if (['yaml', 'yml'].includes(langId)) {
    return highlightYAMLLine(line)
  }
  if (['diff', 'patch'].includes(langId)) {
    return highlightDiffLine(line)
  }

  return line
}

function highlightTSLine(line: string): string {
  const c = syntaxColors
  // Comments first (// and /* */)
  line = line.replace(/\/\/.*$/g, (m) => `${c.comment}${m}${c.reset}`)
  line = line.replace(/\/\*[\s\S]*?\*\//g, (m) => `${c.comment}${m}${c.reset}`)
  // Keywords
  const keywords = /\b(async|await|const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|throw|try|catch|finally|import|export|from|default|class|extends|implements|interface|type|enum|typeof|instanceof|in|of|this|super|yield|static|private|protected|public|readonly|abstract|declare|as|satisfies|null|undefined|true|false|void|never|any|unknown)\b/g
  line = line.replace(keywords, (m) => `${c.keyword}${m}${c.reset}`)
  // Strings (single, double, backtick)
  line = line.replace(/('(?:[^'\\]|\\.)*')/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("(?:[^"\\]|\\.)*")/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/(`(?:[^`\\]|\\.)*`)/g, (m) => `${c.string}${m}${c.reset}`)
  // Numbers
  line = line.replace(/\b(\d+\.?\d*)\b/g, (m) => `${c.number}${m}${c.reset}`)
  // Decorators
  line = line.replace(/^(\s*@\w+)/gm, (m) => `${c.builtin}${m}${c.reset}`)
  // Built-in types
  const builtins = /\b(string|number|boolean|symbol|bigint|object|Array|Promise|Map|Set|Record|Partial|Required|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|Parameters|Readonly|console|Error|Date|RegExp)\b/g
  line = line.replace(builtins, (m) => `${c.builtin}${m}${c.reset}`)
  return line
}

function highlightJSONLine(line: string): string {
  const c = syntaxColors
  // Keys
  line = line.replace(/("(?:[^"\\]|\\.)*")\s*:/g, (m) => `${c.property}${m}${c.reset}`)
  // String values
  line = line.replace(/:(\s*)("(?:[^"\\]|\\.)*")/g, (_, space, str) => `:${space}${c.string}${str}${c.reset}`)
  // Numbers
  line = line.replace(/\b(\d+\.?\d*)\b/g, (m) => `${c.number}${m}${c.reset}`)
  // Keywords
  line = line.replace(/\b(true|false|null)\b/g, (m) => `${c.keyword}${m}${c.reset}`)
  return line
}

function highlightHTMLLine(line: string): string {
  const c = syntaxColors
  // Tags
  line = line.replace(/(<\/?)([\w-]+)/g, (_, bracket, tag) => `${bracket}${c.tag}${tag}${c.reset}`)
  // Attributes
  line = line.replace(/\s(\w[\w-]*)=/g, (m) => ` ${c.attr}${m.trim()}${c.reset}`)
  // Attribute values
  line = line.replace(/=("(?:[^"\\]|\\.)*")/g, (m) => `=${c.string}${m.slice(1)}${c.reset}`)
  // Comments
  line = line.replace(/<!--[\s\S]*?-->/g, (m) => `${c.comment}${m}${c.reset}`)
  return line
}

function highlightCSSLine(line: string): string {
  const c = syntaxColors
  // Properties
  line = line.replace(/([\w-]+)\s*:/g, (m) => `${c.property}${m}${c.reset}`)
  // Values (colors, numbers)
  line = line.replace(/(#[0-9a-fA-F]{3,8})/g, (m) => `${c.number}${m}${c.reset}`)
  line = line.replace(/\b(\d+\.?\d*(px|rem|em|vh|vw|%|s|ms)?)\b/g, (m) => `${c.number}${m}${c.reset}`)
  // Strings
  line = line.replace(/('(?:[^'\\]|\\.)*')/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("(?:[^"\\]|\\.)*")/g, (m) => `${c.string}${m}${c.reset}`)
  // Comments
  line = line.replace(/\/\*[\s\S]*?\*\//g, (m) => `${c.comment}${m}${c.reset}`)
  return line
}

function highlightShellLine(line: string): string {
  const c = syntaxColors
  // Comments
  line = line.replace(/^(\s*#.*)$/gm, (m) => `${c.comment}${m}${c.reset}`)
  // Commands
  line = line.replace(/^(>?\s*)([\w./-]+)/gm, (_, prefix, cmd) => `${prefix}${c.builtin}${cmd}${c.reset}`)
  // Flags
  line = line.replace(/(--?[\w-]+)/g, (m) => `${c.keyword}${m}${c.reset}`)
  // Strings
  line = line.replace(/('(?:[^'\\]|\\.)*')/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("(?:[^"\\]|\\.)*")/g, (m) => `${c.string}${m}${c.reset}`)
  // Variables
  line = line.replace(/\$(\w+|\{[\w]+\})/g, (m) => `${c.variable}${m}${c.reset}`)
  return line
}

function highlightPythonLine(line: string): string {
  const c = syntaxColors
  // Comments
  line = line.replace(/(#.*)$/g, (m) => `${c.comment}${m}${c.reset}`)
  // Keywords
  const keywords = /\b(def|class|if|elif|else|for|while|return|import|from|as|with|try|except|finally|raise|pass|break|continue|yield|lambda|self|None|True|False|and|or|not|in|is|async|await)\b/g
  line = line.replace(keywords, (m) => `${c.keyword}${m}${c.reset}`)
  // Strings
  line = line.replace(/('(?:[^'\\]|\\.)*')/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("(?:[^"\\]|\\.)*")/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("""[\s\S]*?""")/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/('''[\s\S]*?''')/g, (m) => `${c.string}${m}${c.reset}`)
  // Numbers
  line = line.replace(/\b(\d+\.?\d*)\b/g, (m) => `${c.number}${m}${c.reset}`)
  // Decorators
  line = line.replace(/^(\s*@\w+)/gm, (m) => `${c.builtin}${m}${c.reset}`)
  return line
}

function highlightYAMLLine(line: string): string {
  const c = syntaxColors
  // Keys
  line = line.replace(/^(\s*)([\w.-]+)\s*:/gm, (_, space, key) => `${space}${c.property}${key}${c.reset}:`)
  // Comments
  line = line.replace(/(#.*)$/g, (m) => `${c.comment}${m}${c.reset}`)
  // String values in quotes
  line = line.replace(/('(?:[^'\\]|\\.)*')/g, (m) => `${c.string}${m}${c.reset}`)
  line = line.replace(/("(?:[^"\\]|\\.)*")/g, (m) => `${c.string}${m}${c.reset}`)
  // Booleans and null
  line = line.replace(/\b(true|false|null|yes|no|on|off)\b/g, (m) => `${c.keyword}${m}${c.reset}`)
  return line
}

function highlightDiffLine(line: string): string {
  const c = syntaxColors
  if (line.startsWith('+')) return `\x1b[38;2;0;200;100m${line}${c.reset}`
  if (line.startsWith('-')) return `\x1b[38;2;255;80;80m${line}${c.reset}`
  if (line.startsWith('@@')) return `${c.builtin}${line}${c.reset}`
  if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
    return `${c.comment}${line}${c.reset}`
  }
  return line
}

// ── OpenCode-style Header ────────────────────────────────────────────────

class HeaderBar implements Component {
  private mode: string
  private model: string
  private provider: string
  private agentStatus: 'running' | 'idle'
  private planCount: number
  private planName: string
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private projectName: string = ''

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
    this.mode = 'code'
    this.agentStatus = 'idle'
    this.planCount = 0
    this.planName = ''
  }

  setMode(m: string): void { this.mode = m }
  setAgentStatus(s: 'running' | 'idle'): void { this.agentStatus = s }
  setPlanCount(n: number): void { this.planCount = n }
  setPlanName(n: string): void { this.planName = n }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setProjectName(name: string): void { this.projectName = name }
  invalidate(): void {}
  handleInput?(data: string): void {}

  private visibleLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length
  }

  render(width: number): string[] {
    const appName = colors.accent('\u2588 lonny')
    const statusDot = this.agentStatus === 'running'
      ? colors.running('\u25CF')
      : colors.dim('\u25CB')
    const statusLabel = this.agentStatus === 'running'
      ? colors.running('running')
      : colors.dim('idle')
    const modeLabel = colors.warn(this.mode)
    const modelInfo = colors.dim(`${this.provider}/${this.model}`)

    let rightPart = `${statusDot} ${statusLabel}  ${modeLabel}  ${modelInfo}`

    // Show token usage if there are any
    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${this.totalInputTokens} \u25BE${this.totalOutputTokens}  ${totalTokens}`
      const callsStr = `${this.totalApiCalls} calls`
      const projectTag = this.projectName ? `${this.projectName} ` : ''
      rightPart += `  ${colors.dim('|')}  ${colors.dim(`${projectTag}${tokenStr}  ${callsStr}`)}`
    }

    if (this.planCount > 0) {
      rightPart += `  ${colors.dim('|')}  ${colors.accent(`${this.planCount} plan${this.planCount > 1 ? 's' : ''}`)}`
      if (this.planName) rightPart += ` ${colors.dim(this.planName)}`
    }

    const line = ` ${appName}  ${colors.dim('·')}  ${rightPart}`
    const visLen = this.visibleLen(line)
    const padded = visLen < width ? line + ' '.repeat(width - visLen) : line
    return [colors.headerBg(padded), colors.dim('\u2500'.repeat(width))]
  }
}

// ── Rich Footer (cwd | mode | tokens | model | version + command hints) ────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

class RichFooter implements Component {
  private cwd: string
  private mode: string = 'code'
  private model: string = ''
  private provider: string = ''
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private totalApiCalls: number = 0
  private visible = true
  private phase: 'landing' | 'chat' = 'landing'

  constructor(cwd: string, model: string, provider: string) {
    this.cwd = cwd
    this.model = model
    this.provider = provider
  }

  setMode(m: string): void { this.mode = m }
  setModel(model: string, provider: string): void { this.model = model; this.provider = provider }
  setTokenUsage(inputTokens: number, outputTokens: number, apiCalls: number): void {
    this.totalInputTokens = inputTokens
    this.totalOutputTokens = outputTokens
    this.totalApiCalls = apiCalls
  }
  setVisible(v: boolean): void { this.visible = v }
  setPhase(p: 'landing' | 'chat'): void { this.phase = p }

  invalidate(): void {}
  handleInput?(data: string): void {}

  private visibleLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length
  }

  render(width: number): string[] {
    if (!this.visible || width < 40) return []

    const { statusBg, statusText, statusAccent, reset } = landingColors

    // Left: working directory
    const dir = this.cwd.length > 30 ? '...' + this.cwd.slice(-27) : this.cwd
    const leftPart = statusAccent + '\u25A0' + reset + statusBg + statusText + ' ' + dir + reset

    if (this.phase === 'landing') {
      // Minimal: cwd | ready | version
      const centerPart = statusBg + statusText + '  ready  ' + reset
      const rightPart = statusBg + statusText + 'v' + APP_VERSION + ' ' + reset
      const line = leftPart + centerPart + rightPart
      const visLen = this.visibleLen(line)
      const padded = visLen < width
        ? line + statusBg + ' '.repeat(width - visLen) + reset
        : line
      return [padded]
    }

    // ── Chat phase: build segments ────────────────────────────────────────
    const segments: string[] = []

    // Mode tag
    const modeTag = this.mode === 'plan'
      ? `\x1b[38;2;255;200;50m${this.mode}\x1b[0m`
      : `\x1b[38;2;0;200;255m${this.mode}\x1b[0m`
    segments.push(modeTag)

    // Model/provider
    if (this.model) {
      segments.push(`\x1b[38;2;110;110;110m${this.provider}/${this.model}\x1b[0m`)
    }

    // Token usage
    const totalTokens = this.totalInputTokens + this.totalOutputTokens
    if (totalTokens > 0) {
      const tokenStr = `\u25B4${formatTokens(this.totalInputTokens)} \u25BE${formatTokens(this.totalOutputTokens)}  ${formatTokens(totalTokens)}`
      segments.push(`\x1b[38;2;110;110;110m${tokenStr}\x1b[0m`)
      segments.push(`\x1b[38;2;110;110;110m${this.totalApiCalls}c\x1b[0m`)
    }

    // Build center part from segments
    const separator = statusBg + ' \x1b[38;2;60;60;60m\u2502\x1b[0m ' + reset
    const centerContent = statusBg + statusText + '  ' + segments.join(separator) + '  ' + reset

    // Right: version
    const rightPart = statusBg + statusText + 'v' + APP_VERSION + ' ' + reset

    const line = leftPart + centerContent + rightPart

    // If there's extra space, append command hints
    const lineLen = line.length - 2 * statusBg.length - reset.length // approximate
    let result = line
    if (lineLen < width - 40) {
      const hints = [
        '\x1b[38;2;110;110;110m/mode\x1b[0m',
        '\x1b[38;2;110;110;110m/plans\x1b[0m',
        '\x1b[38;2;110;110;110m/help\x1b[0m',
        '\x1b[38;2;110;110;110m?\x1b[0m',
      ].join(' \x1b[38;2;60;60;60m\u00b7\x1b[0m ')
      const hintStr = statusBg + statusText + '  ' + hints + '  ' + reset
      // Only append if it fits
      const fullLine = line + hintStr
      // Calculate approximate visible length (strip ANSI)
      const approxLen = fullLine.replace(/\x1b\[[0-9;]*m/g, '').length
      if (approxLen <= width) {
        result = fullLine
      }
    }

    const visLen = this.visibleLen(result)
    const padded = visLen < width
      ? result + statusBg + ' '.repeat(width - visLen) + reset
      : result

    return [padded]
  }
}

// ── LandingScreen (pixel logo + welcome) ──────────────────────────────

class LandingScreen implements Component {
  onSubmit?: (value: string) => void
  private model: string
  private provider: string

  constructor(model: string, provider: string) {
    this.model = model
    this.provider = provider
  }

  invalidate(): void {}

  handleInput(data: string): void {
    // Any key transitions to chat
    if (data && this.onSubmit) {
      this.onSubmit(data)
    }
  }

  private visibleLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length
  }

  render(width: number): string[] {
    const lines: string[] = []
    const center = (text: string, totalWidth: number): string => {
      const textWidth = this.visibleLen(text)
      const pad = Math.max(0, Math.floor((totalWidth - textWidth) / 2))
      return ' '.repeat(pad) + text
    }

    // ── Pixel logo ─────────────────────────────────────────────────────
    const logoLines = renderPixelLogo()
    const logoPad = Math.max(0, Math.floor((width - PIXEL_LOGO_WIDTH) / 2))
    const padStr = ' '.repeat(logoPad)

    for (const line of logoLines) {
      lines.push(padStr + line)
    }

    // ── Decorative divider ────────────────────────────────────────────
    const divider = colors.dim('\u2500'.repeat(Math.min(36, width - 4)))
    lines.push(center(divider, width))

    // ── Prompt text ───────────────────────────────────────────────────
    lines.push('')
    const prompt = colors.dim('Type a message and press ') + colors.accent('Enter') + colors.dim(' to start')
    lines.push(center(prompt, width))
    lines.push('')

    // ── Quick command hints ───────────────────────────────────────────
    const cmds = [
      colors.inputPrompt('/mode'),
      colors.inputPrompt('/model'),
      colors.inputPrompt('/plans'),
      colors.inputPrompt('/help'),
    ].join(colors.dim('  \u00B7  '))
    lines.push(center(colors.dim('Commands: ') + cmds, width))

    // ── Model & version info ──────────────────────────────────────────
    const modelInfo = colors.dim(`${this.provider}/${this.model}`)
    const versionInfo = colors.dim(`v${APP_VERSION}`)
    lines.push(center(modelInfo + colors.separator('  \u2502  ') + versionInfo, width))

    return lines
  }
}

// ── PlansList wrapper (SelectList has no setItems) ───────────────────────

class PlansList implements Component {
  private selectList: SelectList
  private maxVisible: number
  private theme: SelectListTheme
  private allItems: SelectItem[] = []
  onSelectionChange?: (item: SelectItem) => void

  constructor(items: SelectItem[], maxVisible: number, theme: SelectListTheme) {
    this.allItems = items
    this.selectList = new SelectList(items, maxVisible, theme)
    this.maxVisible = maxVisible
    this.theme = theme
    this.selectList.onSelectionChange = (item) => {
      if (this.onSelectionChange) this.onSelectionChange(item)
    }
  }

  setFilter(filter: string): void {
    this.selectList.setFilter(filter)
  }

  clearFilter(): void {
    this.selectList.setFilter('')
  }

  refresh(items: SelectItem[]): void {
    this.allItems = items
    const cb = this.onSelectionChange
    this.selectList = new SelectList(items, this.maxVisible, this.theme)
    this.selectList.onSelectionChange = cb
  }

  getSelectedItem(): SelectItem | null {
    return this.selectList.getSelectedItem()
  }

  setSelectedIndex(index: number): void {
    this.selectList.setSelectedIndex(index)
  }

  invalidate(): void {
    this.selectList.invalidate()
  }

  render(width: number): string[] {
    return this.selectList.render(width)
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data)
  }
}

// ── Persistent Todo Side Panel ───────────────────────────────────────

class TodoPanel implements Component {
  private cwd: string
  private todos: { text: string; done: boolean }[] = []
  private planName: string = ''
  private dirty: boolean = true

  constructor(cwd: string) {
    this.cwd = cwd
  }

  refresh(): void {
    this.dirty = true
  }

  invalidate(): void {
    this.dirty = true
  }

  private load(): void {
    this.dirty = false
    const plans = listPlans(this.cwd)
    if (plans.length === 0) {
      this.todos = []
      this.planName = ''
      return
    }
    const plan = plans[0]
    this.planName = plan.name
    this.todos = []
    try {
      const content = fs.readFileSync(plan.fullPath, 'utf-8')
      const lines = content.split('\n')
      let inTodo = false
      for (const line of lines) {
        if (line.startsWith('## Todo List')) { inTodo = true; continue }
        if (inTodo && line.startsWith('## ')) break
        if (inTodo) {
          const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
          if (m) {
            this.todos.push({ text: m[2], done: m[1] === 'x' })
          }
        }
      }
    } catch {
      // ignore file read errors
    }
  }

  private visibleLen(s: string): number {
    return s.replace(/\x1b\[[0-9;]*m/g, '').length
  }

  render(width: number): string[] {
    if (this.dirty) this.load()

    const lines: string[] = []

    // ── Header ──
    const headerText = ` ${colors.accent('\u25B6')} TODO`
    const headerPadding = Math.max(0, width - this.visibleLen(headerText))
    lines.push(colors.bgDark(headerText + ' '.repeat(headerPadding)))

    // ── Divider ──
    lines.push(colors.separator('\u2500'.repeat(width)))

    if (!this.planName) {
      lines.push(colors.dim('  (no plan)'))
      return lines
    }

    if (this.todos.length === 0) {
      lines.push(colors.dim('  (no todos)'))
      return lines
    }

    // ── Todo items ──
    const contentWidth = width - 3 // leave room for icon + space
    for (const todo of this.todos) {
      const icon = todo.done ? '\u2705' : '\u2B1C'
      const textStyle = todo.done ? colors.doneTodo : colors.todo
      let text = todo.text
      // Truncate text if too long (account for visible width)
      const maxTextLen = contentWidth - 1 // 1 for space after icon
      let truncated = text
      let textVisLen = this.visibleLen(textStyle(text))
      if (textVisLen > maxTextLen) {
        // Simple truncation: cut raw text and add ellipsis
        truncated = text.slice(0, maxTextLen - 1) + '\u2026'
        textVisLen = maxTextLen
      }
      const line = ` ${icon} ${textStyle(truncated)}`
      const visLen = this.visibleLen(line)
      const padding = Math.max(0, width - visLen)
      lines.push(line + ' '.repeat(padding))
    }

    return lines
  }
}

// ── startTui ─────────────────────────────────────────────────────────────

export async function startTui(config: Config): Promise<void> {
  let chatContent = ''
  let isRunning = false
  let session: Session

  // ── Create markdown theme (OpenCode-style, clean colors, with syntax highlighting) ──
  const markdownTheme: MarkdownTheme = {
    heading: (t) => `\x1b[38;2;0;170;255m\x1b[1m${t}\x1b[0m`,
    link: (t) => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
    linkUrl: (t) => `\x1b[38;2;90;90;90m\x1b[4m${t}\x1b[0m`,
    code: (t) => `\x1b[38;2;255;180;50m${t}\x1b[0m`,
    codeBlock: (t) => `\x1b[38;2;200;200;200m${t}\x1b[0m`,
    codeBlockBorder: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    highlightCode: (code: string, lang?: string) => {
      if (lang && lang.trim()) {
        const lines = code.split('\n')
        return lines.map(line => highlightLine(line, lang))
      }
      return code.split('\n')
    },
    codeBlockIndent: '  ',
    quote: (t) => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    quoteBorder: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    hr: (t) => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
    listBullet: (t) => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
    bold: (t) => `\x1b[1m${t}\x1b[0m`,
    italic: (t) => `\x1b[3m${t}\x1b[0m`,
    strikethrough: (t) => `\x1b[9m${t}\x1b[0m`,
    underline: (t) => `\x1b[4m${t}\x1b[0m`,
  }

  // ── Create select list theme ───────────────────────────────────────────
  const selectTheme: SelectListTheme = {
    selectedPrefix: (t) => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m ${t}\x1b[0m`,
    selectedText: (t) => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m${t}\x1b[0m`,
    description: (t) => `\x1b[90m${t}\x1b[0m`,
    scrollInfo: (t) => `\x1b[90m${t}\x1b[0m`,
    noMatch: (t) => `\x1b[38;2;255;100;100m${t}\x1b[0m`,
  }

  // ── Create editor theme (used by Editor component) ────────────────────
  const editorTheme: EditorTheme = {
    borderColor: (str: string) => colors.accent(str),
    selectList: selectTheme,
  }

  // ── Create terminal and TUI ────────────────────────────────────────────
  const terminal = new ProcessTerminal()
  const tui = new TUI(terminal, false)
  tui.setClearOnShrink(true)
  terminal.setTitle(`lonny ${config.model} ${config.provider}`)

  // ── Create components (OpenCode-style layout) ──────────────────────────

  // Top header bar
  const header = new HeaderBar(config.model, config.provider)
  tui.showOverlay(header, { anchor: 'top-left', row: 0, col: 0, nonCapturing: true })

  // Chat area (full width, no side panel) — created upfront but only added
  // to the TUI after the landing screen transitions to chat mode.
  const chatMarkdown = new Markdown('', 1, 0, markdownTheme)
  const chatBox = new Box(1, 0)
  chatBox.addChild(chatMarkdown)

  // Chat input — Editor with multi-line support, history, and autocomplete
  const slashCommands: SlashCommand[] = [
    { name: 'mode', description: 'Switch mode (code|plan)', argumentHint: 'code|plan' },
    { name: 'model', description: 'Switch model', argumentHint: '<name>' },
    { name: 'plans', description: 'Show plans overlay' },
    { name: 'prompts', description: 'List prompt templates' },
    { name: 'skills', description: 'List active skills' },
    { name: 'new', description: 'Start a new session' },
    { name: 'init', description: 'Create .lonny/skills/ & prompts/' },
    { name: 'help', description: 'Show help' },
    { name: 'stop', description: 'Stop the running agent' },
    { name: 'exit', description: 'Exit' },
    { name: 'filter', description: 'Filter plans', argumentHint: '<query>' },
  ]
  const editor = new Editor(tui, editorTheme)
  editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands, config.cwd))

  // Loader (thinking indicator)
  const loader = new Loader(tui, colors.running, colors.idle, 'thinking...', { intervalMs: 80 })

  // Rich footer (cwd | mode | tokens | model | version + command hints)
  const footer = new RichFooter(config.cwd, config.model, config.provider)

  // ── Build layout (landing phase) ───────────────────────────────────────
  // In the landing phase, only the Spacer (for header overlay offset) and
  // the header bar are shown. The chatBox, editor, loader, and footer are
  // added after the first message (see landingScreen.onSubmit).
  tui.addChild(new Spacer(1)) // offset for fixed header overlay

  // ── Plan written callback (defined early since it's used by session restore) ──
  const planCb = () => {
    refreshPlans()
    todoPanel.refresh()
    if (plansOverlayHandle?.isHidden() === false) {
      showPlansOverlay()
    }
  }

  // ── Session output ─────────────────────────────────────────────────────
  // Tool call/result text flows through output.write naturally, interspersed
  // with assistant text in the correct order (just like non-TUI mode).
  const output: SessionOutput = {
    write: (text: string) => {
      chatContent += text
      chatMarkdown.setText(chatContent)
    },
    suppressToolOutput: false,
  }

  // Try to restore a saved session for this directory (MUST be before landing screen setup)
  let restored = false
  const restoredSession = Session.load(config, output)
  if (restoredSession) {
    restored = true
    session = restoredSession
    session.onPlanWritten = planCb
    // Find the last user message from the previous session
    const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user')
    const lastQuestion = lastUserMsg && typeof lastUserMsg.content === 'string'
      ? lastUserMsg.content
      : null
    chatContent = '\n' + colors.dim('\u21BA Resumed previous session')
    if (lastQuestion) {
      const preview = lastQuestion.length > 80 ? lastQuestion.slice(0, 80) + '\u2026' : lastQuestion
      chatContent += ` \u2014 ${colors.userLabel(preview)}`
    }
    chatContent += '\n\n'
    chatMarkdown.setText(chatContent)
  } else {
    session = new Session(config, output)
    session.onPlanWritten = planCb
  }

  // ── Landing screen (centered overlay with pixel logo) ─────────────────
  const landingScreen = new LandingScreen(config.model, config.provider)
  let landingOverlayHandle: OverlayHandle | null = null
  // Only show the landing screen if no session was restored
  if (!restored) {
    landingOverlayHandle = tui.showOverlay(landingScreen, {
      anchor: 'center',
      width: 70,
      maxHeight: 14,
    })
    tui.setFocus(landingScreen)
  }

  // ── Rich footer bar ──────────────────────────────────
  // NOTE: must be added AFTER the landing screen overlay so it renders on
  // top and is not covered by the centered overlay.
  const footerWidth = terminal.columns ?? process.stdout.columns ?? 120
  const footerHandle = tui.showOverlay(footer, {
    anchor: 'bottom-left',
    width: footerWidth,
    nonCapturing: true,
  })

  // ── Persistent Todo Side Panel ────────────────────────────────────────
  const todoPanel = new TodoPanel(config.cwd)
  let todoPanelHandle: OverlayHandle | null = null

  function showTodoPanel(): void {
    todoPanel.refresh()
    const box = new Box(0, 0, colors.bgDark)
    box.addChild(todoPanel)
    todoPanelHandle = tui.showOverlay(box, {
      anchor: 'top-right',
      offsetY: 2,
      width: 36,
      maxHeight: '70%',
      offsetX: -1,
      nonCapturing: true,
      visible: (w: number) => w >= 110,
    })
  }

  // If a session was restored, immediately transition to chat layout
  // (skip the landing screen)
  if (restored) {
    footer.setPhase('chat')
    tui.addChild(chatBox)
    tui.addChild(editor)
    tui.addChild(loader)
    showTodoPanel()
    tui.setFocus(editor)
  }

  // ── Plans overlay components ───────────────────────────────────────────
  const plansList = new PlansList([], 15, selectTheme)
  let plansOverlayHandle: OverlayHandle | null = null
  let plansDetailMode = false

  function showPlansOverlay(): void {
    if (plansOverlayHandle?.isHidden() === false) {
      plansOverlayHandle.hide()
      plansOverlayHandle = null
      plansDetailMode = false
      return
    }
    plansDetailMode = false
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))

    const headerText = new Text(
      ` ${colors.accent('\u25B6')} Plans (${plans.length})  ${colors.dim('Enter=view')}`,
      1, 0, colors.headerBg
    )
    const container = new Container()
    container.addChild(headerText)
    if (plans.length > 0) {
      container.addChild(plansList)
    } else {
      container.addChild(new Text('  (no plans yet)', 1, 0, colors.dim))
    }

    const box = new Box(1, 1, colors.bgDark)
    box.addChild(container)

    plansOverlayHandle = tui.showOverlay(box, {
      anchor: 'right-center',
      width: 45,
      maxHeight: '70%',
      offsetX: -1,
    })
  }

  function showPlanDetail(): void {
    if (!plansOverlayHandle || plansOverlayHandle.isHidden()) return
    const sel = plansList.getSelectedItem()
    if (!sel) return

    plansDetailMode = true
    const plans = listPlans(config.cwd)
    const plan = plans.find(p => p.name === sel.value)
    if (!plan) return

    const todos = loadTodos(plan.fullPath)
    const headerText = new Text(
      ` ${colors.accent('\u25B6')} ${colors.warn(plan.name)}  ${colors.dim('Esc=back')}`,
      1, 0, colors.headerBg
    )
    const todosText = new Text(`\n  ${todos}\n`, 1, 0)
    const container = new Container()
    container.addChild(headerText)
    container.addChild(todosText)

    const box = new Box(1, 1, colors.bgDark)
    box.addChild(container)

    // Hide current and show detail
    plansOverlayHandle.hide()
    plansOverlayHandle = tui.showOverlay(box, {
      anchor: 'right-center',
      width: 50,
      maxHeight: '80%',
      offsetX: -1,
    })
  }

  // ── Help overlay ───────────────────────────────────────────────────────────
  let helpOverlayHandle: OverlayHandle | null = null

  function showHelpOverlay(): void {
    if (helpOverlayHandle?.isHidden() === false) {
      helpOverlayHandle.hide()
      helpOverlayHandle = null
      return
    }
    const helpContent =
      colors.accent('\u2501').repeat(20) + '\n' +
      ` ${colors.accent('lonny')} ${colors.dim('TUI Help')}\n` +
      colors.accent('\u2501').repeat(20) + '\n\n' +
      ` ${colors.dim('Commands:')}\n` +
      `   ${colors.inputPrompt('/mode')} code|plan  ${colors.dim('Switch mode')}\n` +
      `   ${colors.inputPrompt('/model')} <name>    ${colors.dim('Switch model')}\n` +
      `   ${colors.inputPrompt('/plans')}          ${colors.dim('Show plans overlay')}\n` +
      `   ${colors.inputPrompt('/new')}            ${colors.dim('Start a new session')}\n` +
      `   ${colors.inputPrompt('/prompts')}        ${colors.dim('List prompt templates')}\n` +
      `   ${colors.inputPrompt('/skills')}         ${colors.dim('List active skills')}\n` +
      `   ${colors.inputPrompt('/init')}           ${colors.dim('Create .lonny/skills/ & prompts/')}\n` +
      `   ${colors.inputPrompt('/stop')}           ${colors.dim('Stop the running agent')}\n` +
      `   ${colors.inputPrompt('/exit')}           ${colors.dim('Exit')}\n` +
      `   ${colors.inputPrompt('/help')}           ${colors.dim('This help')}\n\n` +
      ` ${colors.dim('Keyboard:')}\n` +
      `   ${colors.dim('Enter')}        ${colors.dim('Send message')}\n` +
      `   ${colors.dim('↑/↓')}          ${colors.dim('Navigate history')}\n` +
      `   ${colors.dim('Tab')}          ${colors.dim('Autocomplete')}\n` +
      `   ${colors.dim('?')}            ${colors.dim('Toggle this help')}\n\n` +
      colors.accent('\u2501').repeat(20)
    const helpText = new Text(helpContent, 1, 0)
    const helpBox = new Box(1, 1, colors.bgDark)
    helpBox.addChild(helpText)
    helpOverlayHandle = tui.showOverlay(helpBox, {
      anchor: 'center',
      width: 46,
      maxHeight: 22,
    })
  }

  // ── Update helpers ──────────────────────────────────────────────────────
  function updateHeader(): void {
    const plans = listPlans(config.cwd)
    header.setMode(session?.config.mode === 'plan' ? 'plan' : 'code')
    header.setAgentStatus(isRunning ? 'running' : 'idle')
    header.setPlanCount(plans.length)
    const sel = plansList.getSelectedItem()
    header.setPlanName(sel ? sel.label : '')
    // Load persisted token stats (cumulative across all sessions for this project)
    const tokenStats = loadTokenUsage(config.cwd)
    header.setProjectName(tokenStats.projectName)
    header.setTokenUsage(tokenStats.totalInputTokens, tokenStats.totalOutputTokens, tokenStats.totalApiCalls)
    // Also update footer with latest state
    footer.setMode(session?.config.mode === 'plan' ? 'plan' : 'code')
    footer.setModel(config.model, config.provider)
    footer.setTokenUsage(tokenStats.totalInputTokens, tokenStats.totalOutputTokens, tokenStats.totalApiCalls)
    tui.requestRender(true)
  }

  function refreshPlans(): void {
    const plans = listPlans(config.cwd)
    plansList.refresh(plansToItems(plans))
    todoPanel.refresh()
    updateHeader()
  }

  // ── Input handling ──────────────────────────────────────────────────────
  function sendMessage(text: string): void {
    if (!text.trim() || isRunning) return
    const trimmed = text.trim()
    editor.setText('')
    editor.addToHistory(trimmed)

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(/\s+/)
      const cmd = parts[0]
      const arg = parts.slice(1).join(' ')

      if (cmd === 'exit' || cmd === 'quit') {
        chatContent += `\n${colors.dim('Goodbye!')}\n`
        chatMarkdown.setText(chatContent)
        tui.stop()
        process.exit(0)
        return
      }

      if (cmd === 'new') {
        Session.clearSavedSession(config.cwd)
        resetTokenUsage(config.cwd)
        session = new Session(config, output)
        session.onPlanWritten = planCb
        chatContent = ''
        chatMarkdown.setText('')
        plansList.clearFilter()
        updateHeader()
        return
      }

      if (cmd === 'mode') {
        if (arg === 'code' || arg === 'plan') {
          session.setMode(arg)
          chatContent += `\n${colors.warn('\u21E8')} Switched to ${colors.warn(arg)} mode\n`
          chatMarkdown.setText(chatContent)
          updateHeader()
        } else {
          chatContent += `\n${colors.error('\u2716')} Usage: ${colors.inputPrompt('/mode code|plan')}  (current: ${session.config.mode})\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      if (cmd === 'model') {
        if (arg) {
          session.config.model = arg
          // Rebuild system prompt with new model context
          session.setMode(session.config.mode) // triggers rebuild
          chatContent += `\n${colors.warn('\u21E8')} Model switched to ${colors.warn(arg)}\n`
          chatMarkdown.setText(chatContent)
          updateHeader()
        } else {
          chatContent += `\n${colors.inputPrompt('Current model:')} ${colors.dim(session.config.model)}\n`
          chatMarkdown.setText(chatContent)
        }
        return
      }

      if (cmd === 'prompts') {
        const templates = loadPromptTemplates(config.cwd)
        if (templates.length === 0) {
          chatContent += `\n${colors.warn('No prompt templates found.')} ${colors.dim('Create .md files in .lonny/prompts/')}\n`
        } else {
          chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Prompt Templates (${templates.length})`)}\n`
          for (const t of templates) {
            chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(t.name)}`
            if (t.description) chatContent += ` ${colors.dim('\u2014 ' + t.description)}`
            chatContent += '\n'
          }
        }
        chatMarkdown.setText(chatContent)
        return
      }

      if (cmd === 'skills') {
        const skills = loadSkills(config.cwd)
        if (skills.length === 0) {
          chatContent += `\n${colors.warn('No skills loaded.')} ${colors.dim('Create .md files in .lonny/skills/')}\n`
        } else {
          chatContent += `\n${colors.accent('\u25B6')} ${colors.warn(`Active Skills (${skills.length})`)}\n`
          for (const s of skills) {
            chatContent += `  ${colors.dim('\u2022')} ${colors.inputPrompt(s.name)}`
            if (s.description) chatContent += ` ${colors.dim('\u2014 ' + s.description)}`
            chatContent += '\n'
          }
        }
        chatMarkdown.setText(chatContent)
        return
      }

      if (cmd === 'plans') {
        showPlansOverlay()
        return
      }

      if (cmd === 'filter') {
        plansList.setFilter(arg)
        tui.requestRender(true)
        return
      }

      if (cmd === 'help' || cmd === '?') {
        showHelpOverlay()
        return
      }

      if (cmd === 'init') {
        ensureSkillsDir(config.cwd)
        ensurePromptsDir(config.cwd)
        chatContent += `\n${colors.success('\u2714')} Initialized .lonny/skills/ and .lonny/prompts/\n`
        chatMarkdown.setText(chatContent)
        return
      }

      if (cmd === 'stop') {
        if (!isRunning) {
          chatContent += `\n${colors.dim('Agent is not running.')}\n`
          chatMarkdown.setText(chatContent)
          return
        }
        // Tell the session to stop gracefully
        session.stop()
        chatContent += `\n${colors.warn('\u23F9')} Stopping agent...\n`
        chatMarkdown.setText(chatContent)
        isRunning = false
        loader.setMessage('')
        tui.setShowHardwareCursor(true)
        updateHeader()
        return
      }

      chatContent += `\n${colors.error('\u2716')} Unknown command: /${cmd}. ${colors.dim('Type /help for available commands.')}\n`
      chatMarkdown.setText(chatContent)
      return
    }

    isRunning = true
    loader.setMessage('thinking...')
    tui.setShowHardwareCursor(false)
    updateHeader()

    session.chat(trimmed).then(() => {
      isRunning = false
      loader.setMessage('')
      refreshPlans()
      tui.setShowHardwareCursor(true)
      updateHeader()
    }).catch((err: unknown) => {
      isRunning = false
      loader.setMessage('')
      const errMsg = err instanceof Error ? err.message : String(err)
      chatContent += `\n${colors.error('\u2716 Error:')} ${errMsg}\n`
      chatMarkdown.setText(chatContent)
      tui.setShowHardwareCursor(true)
      updateHeader()
    })
  }

  // Wire up submit on editor (after landing transition)
  editor.onSubmit = (value: string) => {
    sendMessage(value)
  }

  // ── Landing screen transition ────────────────────────────────────────────
  // When the user presses any key on the landing screen, transition to the
  // full chat layout (editor + chat area).
  landingScreen.onSubmit = () => {
    if (isRunning) return

    // Hide the landing overlay
    if (landingOverlayHandle) landingOverlayHandle.hide()
    footer.setPhase('chat')

    // Add chat components to the main TUI
    // (footer is already an overlay anchored to bottom-left, no need to addChild)
    tui.addChild(chatBox)
    tui.addChild(editor)
    tui.addChild(loader)

    showTodoPanel()

    // Focus the chat editor
    tui.setFocus(editor)
    tui.requestRender(true)
  }

  // ── Input listener ───────────────────────────────────────────────────────
  tui.addInputListener((data) => {
    // Check if help overlay is active
    if (helpOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[' || data === '?') {
        helpOverlayHandle.hide()
        helpOverlayHandle = null
      }
      return { consume: true }
    }

    // Check if plans overlay is active
    if (plansOverlayHandle?.isHidden() === false) {
      if (data === '\x1b' || data === '\x1b[') {
        if (plansDetailMode) {
          // Go back to plan list
          plansOverlayHandle.hide()
          plansOverlayHandle = null
          plansDetailMode = false
          showPlansOverlay()
        } else {
          plansOverlayHandle.hide()
          plansOverlayHandle = null
        }
        return { consume: true }
      }
      if (data === '\r' && !plansDetailMode) {
        // Enter: view plan detail
        showPlanDetail()
        return { consume: true }
      }
      if (data === '\x1b[A') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx <= 0 ? plans.length - 1 : idx - 1
          plansList.setSelectedIndex(nextIdx)
          updateHeader()
        }
        return { consume: true }
      }
      if (data === '\x1b[B') {
        const plans = listPlans(config.cwd)
        if (plans.length > 0) {
          const sel = plansList.getSelectedItem()
          const idx = sel ? plans.findIndex(p => p.name === sel.value) : -1
          const nextIdx = idx === -1 ? 0 : (idx + 1) % plans.length
          plansList.setSelectedIndex(nextIdx)
          updateHeader()
        }
        return { consume: true }
      }
      return { consume: true }
    }

    if (data === '?') {
      showHelpOverlay()
      return { consume: true }
    }

    return undefined
  })

  // ── Initial render ─────────────────────────────────────────────────────
  loader.setMessage('')
  refreshPlans()

  // If no session was restored, keep the landing screen and clear chat.
  // If a session was restored, chatContent already has the resume message.
  if (!restored) {
    chatMarkdown.setText('')
  }

  tui.start()

  // Keep alive
  await new Promise<void>(() => {})
}