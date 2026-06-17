import type { EditorTheme, MarkdownTheme, SelectListTheme } from '../pi-tui/index.js'
import { colors } from './components/index.js'
import { highlightLine } from './highlight.js'

export const markdownTheme: MarkdownTheme = {
  heading: t => `\x1b[38;2;0;170;255m\x1b[1m${t}\x1b[0m`,
  link: t => `\x1b[38;2;0;170;255m\x1b[4m${t}\x1b[0m`,
  linkUrl: t => `\x1b[38;2;90;90;90m\x1b[4m${t}\x1b[0m`,
  code: t => `\x1b[38;2;255;180;50m${t}\x1b[0m`,
  codeBlock: t => `\x1b[38;2;200;200;200m${t}\x1b[0m`,
  codeBlockBorder: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
  highlightCode: (code: string, lang?: string) => {
    if (lang && lang.trim()) {
      const lines = code.split('\n')
      return lines.map(line => highlightLine(line, lang))
    }
    return code.split('\n')
  },
  codeBlockIndent: '  ',
  quote: t => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
  quoteBorder: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
  hr: t => `\x1b[38;2;60;60;60m${t}\x1b[0m`,
  listBullet: t => `\x1b[38;2;130;130;130m${t}\x1b[0m`,
  bold: t => `\x1b[1m${t}\x1b[0m`,
  italic: t => `\x1b[3m${t}\x1b[0m`,
  strikethrough: t => `\x1b[9m${t}\x1b[0m`,
  underline: t => `\x1b[4m${t}\x1b[0m`,
}

export const selectTheme: SelectListTheme = {
  selectedPrefix: t => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m ${t}\x1b[0m`,
  selectedText: t => `\x1b[38;2;255;255;255m\x1b[48;2;0;128;255m${t}\x1b[0m`,
  description: t => `\x1b[90m${t}\x1b[0m`,
  scrollInfo: t => `\x1b[90m${t}\x1b[0m`,
  noMatch: t => `\x1b[38;2;255;100;100m${t}\x1b[0m`,
}

export const editorTheme: EditorTheme = {
  borderColor: (str: string) => colors.accent(str),
  selectList: selectTheme,
}
