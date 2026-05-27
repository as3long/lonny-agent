import * as fs from 'node:fs'
import * as path from 'node:path'
import { EventChannels, getGlobalEventBus } from './event-bus.js'

/**
 * Prompt Templates — loads reusable prompt snippets from `.lonny/prompts/` directory.
 * Inspired by pi's prompt-templates.ts.
 *
 * Each template is a Markdown file with frontmatter:
 * ```markdown
 * ---
 * name: fix-typo
 * description: Fix a typo in a file
 * ---
 * Fix any typos in $1
 * ```
 *
 * Supports argument substitution: $1, $2, $@ for all args
 */

export interface PromptTemplate {
  name: string
  description: string
  content: string
  filePath: string
  argumentHint?: string
}

const PROMPTS_DIR = '.lonny/prompts'

/** Get the prompts directory path */
export function getPromptsDir(cwd: string): string {
  return path.resolve(cwd, PROMPTS_DIR)
}

/** Parse frontmatter from template file */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatter: Record<string, string> = {}
  let body = content

  if (content.startsWith('---\n')) {
    const endIdx = content.indexOf('\n---\n', 4)
    if (endIdx !== -1) {
      const fmLines = content.slice(4, endIdx).split('\n')
      for (const line of fmLines) {
        const colonIdx = line.indexOf(':')
        if (colonIdx !== -1) {
          const key = line.slice(0, colonIdx).trim()
          const val = line.slice(colonIdx + 1).trim()
          frontmatter[key] = val
        }
      }
      body = content.slice(endIdx + 5)
    }
  }

  return { frontmatter, body: body.trim() }
}

/** Substitute arguments in template content */
function substituteArgs(content: string, args: string[]): string {
  let result = content

  // Replace $1, $2, ... with positional args
  result = result.replace(/\$(\d+)/g, (_, num) => {
    const index = parseInt(num, 10) - 1
    return args[index] ?? ''
  })

  // Replace $@ with all args joined by space
  result = result.replace(/\$@/g, args.join(' '))

  // Replace $ARGUMENTS with all args joined by space
  result = result.replace(/\$ARGUMENTS/g, args.join(' '))

  return result
}

/** Load all prompt templates */
export function loadPromptTemplates(cwd: string): PromptTemplate[] {
  const promptsDir = getPromptsDir(cwd)
  const templates: PromptTemplate[] = []

  try {
    if (!fs.existsSync(promptsDir)) {
      return templates
    }

    const files = fs.readdirSync(promptsDir)
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const filePath = path.join(promptsDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter(content)

        const name = frontmatter.name || file.replace(/\.md$/, '')
        const description = frontmatter.description || ''

        // Validate name (lowercase, digits, hyphens)
        if (!/^[a-z0-9-]+$/.test(name)) {
          console.warn(`[Prompts] Skipping "${file}": invalid name "${name}"`)
          continue
        }

        templates.push({
          name,
          description,
          content: body,
          filePath,
          argumentHint: frontmatter['argument-hint'],
        })
      } catch (err) {
        console.warn(`[Prompts] Error loading "${file}": ${err}`)
      }
    }
  } catch (err) {
    console.warn(`[Prompts] Error reading prompts directory: ${err}`)
  }

  getGlobalEventBus().emit(EventChannels.PROMPTS_LOADED, { templates, count: templates.length })

  return templates
}

/** Apply a template with arguments */
export function applyTemplate(template: PromptTemplate, args: string[]): string {
  return substituteArgs(template.content, args)
}

/** Find a template by name (case-insensitive) */
export function findTemplate(
  templates: PromptTemplate[],
  name: string,
): PromptTemplate | undefined {
  return templates.find(t => t.name.toLowerCase() === name.toLowerCase())
}

/** Ensure the prompts directory exists */
export function ensurePromptsDir(cwd: string): void {
  const dir = getPromptsDir(cwd)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
