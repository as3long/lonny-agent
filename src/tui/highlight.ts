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
export function highlightLine(line: string, lang: string): string {
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
