import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { getGlobalEventBus, EventChannels } from './event-bus.js'

/**
 * Skills system — loads custom instructions from `.lonny/skills/` directory.
 * Inspired by pi's skills system.
 *
 * Each skill is a Markdown file with optional frontmatter:
 * ```markdown
 * ---
 * name: my-skill
 * description: What this skill does
 * ---
 * Your custom instructions here...
 * ```
 */

export interface Skill {
  name: string
  description: string
  content: string
  filePath: string
}

const SKILLS_DIR = '.lonny/skills'

/** Get the skills directory path */
export function getSkillsDir(cwd: string): string {
  return path.resolve(cwd, SKILLS_DIR)
}

/** Parse frontmatter from a markdown file */
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

/** Load all skills from the skills directory */
export function loadSkills(cwd: string): Skill[] {
  const skillsDir = getSkillsDir(cwd)
  const skills: Skill[] = []

  try {
    if (!fs.existsSync(skillsDir)) {
      return skills
    }

    const files = fs.readdirSync(skillsDir)
    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const filePath = path.join(skillsDir, file)
      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const { frontmatter, body } = parseFrontmatter(content)

        const name = frontmatter.name || file.replace(/\.md$/, '')
        const description = frontmatter.description || ''

        // Validate name (lowercase, digits, hyphens)
        if (!/^[a-z0-9-]+$/.test(name)) {
          console.warn(`[Skills] Skipping "${file}": invalid name "${name}" (use lowercase, digits, hyphens)`)
          continue
        }

        skills.push({ name, description, content: body, filePath })
      } catch (err) {
        console.warn(`[Skills] Error loading "${file}": ${err}`)
      }
    }
  } catch (err) {
    console.warn(`[Skills] Error reading skills directory: ${err}`)
  }

  // Emit event
  getGlobalEventBus().emit(EventChannels.SKILLS_LOADED, { skills, count: skills.length })

  return skills
}

/** Format skills into a system prompt section */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return ''

  const parts = skills.map(s => {
    let block = `### Skill: ${s.name}`
    if (s.description) block += ` — ${s.description}`
    block += `\n${s.content}`
    return block
  })

  return `\n## Active Skills\n\n${parts.join('\n\n')}`
}

/** Ensure the skills directory exists */
export function ensureSkillsDir(cwd: string): void {
  const dir = getSkillsDir(cwd)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
