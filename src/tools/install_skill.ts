import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
// @ts-expect-error - adm-zip has no types
import AdmZip from 'adm-zip'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

// ── Constants ────────────────────────────────────────────────────────────────

const SKILLS_DIR = '.lonny/skills'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
const CLAWHUB_API_BASE = 'https://clawhub.ai/api/v1'
const CLAWHUB_SITE = 'https://clawhub.ai'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch package info from npm registry */
async function fetchNpmPackageInfo(
  packageName: string,
): Promise<{ description: string; readme: string } | null> {
  try {
    const response = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      description?: string
      readme?: string
    }
    return {
      description: data.description || '',
      readme: data.readme || '',
    }
  } catch {
    return null
  }
}

// ── ClawHub Helpers ──────────────────────────────────────────────────────────

/** Fetch skill info from ClawHub API */
async function fetchClawHubSkillInfo(
  slug: string,
): Promise<{ displayName: string; summary: string; latestVersion: string } | null> {
  try {
    const response = await fetch(`${CLAWHUB_API_BASE}/skills/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      skill?: { displayName?: string; summary?: string }
      latestVersion?: { version?: string }
    }
    return {
      displayName: data.skill?.displayName || slug,
      summary: data.skill?.summary || '',
      latestVersion: data.latestVersion?.version || 'latest',
    }
  } catch {
    return null
  }
}

/** Download a ClawHub skill as a ZIP and extract its content */
async function downloadClawHubSkill(
  slug: string,
  version?: string,
): Promise<{ files: Map<string, string> } | null> {
  try {
    const versionPath = version ? `/${version}` : ''
    const url = `${CLAWHUB_API_BASE}/download?slug=${encodeURIComponent(slug)}${version ? `&version=${encodeURIComponent(version)}` : ''}`
    const response = await fetch(url)
    if (!response.ok) {
      // Try alternative URL patterns
      const altUrl = `${CLAWHUB_API_BASE}/download/${encodeURIComponent(slug)}${versionPath}`
      const altResponse = await fetch(altUrl)
      if (!altResponse.ok) return null

      const buffer = await altResponse.arrayBuffer()
      return extractZipContent(Buffer.from(buffer))
    }

    const buffer = await response.arrayBuffer()
    return extractZipContent(Buffer.from(buffer))
  } catch {
    return null
  }
}

/** Extract files from a ZIP buffer */
function extractZipContent(buffer: Buffer): { files: Map<string, string> } {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  const files = new Map<string, string>()

  for (const entry of entries) {
    if (!entry.isDirectory) {
      files.set(entry.entryName, entry.getData().toString('utf-8'))
    }
  }

  return { files }
}

/** Sanitize a package name to a valid skill name (lowercase, digits, hyphens) */
function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/@/g, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Generate a usage guide snippet from the readme */
function extractUsageGuide(readme: string): string {
  // Try to extract code examples from the readme
  const codeBlocks: string[] = []
  const blockRegex = /```(?:js|javascript|ts|typescript|bash)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null = blockRegex.exec(readme)
  while (match !== null) {
    const block = match[1].trim()
    if (block.length > 0 && block.length < 1000) {
      codeBlocks.push(block)
    }
    match = blockRegex.exec(readme)
  }
  return codeBlocks.slice(0, 3).join('\n\n')
}

/** Generate the skill markdown content (npm package) */
function generateSkillContent(
  packageName: string,
  description: string,
  usageGuide: string,
): string {
  const installCmd = `npm install ${packageName}`

  let content = `---
name: ${sanitizeSkillName(packageName)}
description: ${description}
---

# ${packageName}

${description}

## Installation

This package is already installed in the project via \`${installCmd}\`.

## Usage

You can import and use this package in your code:

\`\`\`typescript
import ${packageName.replace(/@/, '').replace(/[/-]/g, '_')} from '${packageName}'
\`\`\`
`

  if (usageGuide) {
    content += `\n## Examples\n\n${usageGuide}\n`
  }

  content += `
## Notes

- This skill was automatically installed. The package is available as a project dependency.
- Refer to the package's npm page or repository for full documentation.
`

  return content
}

/** Generate the skill markdown content (ClawHub skill) */
function generateClawHubSkillContent(
  slug: string,
  displayName: string,
  summary: string,
  clawhubContent: string,
): string {
  // If the ZIP contains a SKILL.md, use it directly
  // Otherwise, generate a wrapper skill file
  let content = `---
name: ${sanitizeSkillName(slug)}
description: ${summary || displayName}
clawhub: ${slug}
---

# ${displayName}

${summary || 'ClawHub skill: ' + slug}

`

  if (clawhubContent) {
    content += clawhubContent + '\n'
  }

  content += `
## Notes

- This skill was installed from [ClawHub](${CLAWHUB_SITE}/${slug}).
- Source: ${CLAWHUB_SITE}/${slug}
- The skill instructions are loaded automatically on the next turn.
`

  return content
}

/** Run npm install in the project directory */
async function runNpmInstall(cwd: string, packageName: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = cp.spawn('npm', ['install', packageName], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timeout = setTimeout(() => {
      child.kill()
      resolve(`Timed out after 60s. ${stderr.slice(0, 500)}`)
    }, 60_000)

    child.on('close', code => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(null) // success
      } else {
        resolve(stderr.slice(0, 500) || `npm install exited with code ${code}`)
      }
    })

    child.on('error', err => {
      clearTimeout(timeout)
      resolve(`Failed to start npm install: ${err.message}`)
    })
  })
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export function createInstallSkillTool(cwd: string): Tool {
  return {
    definition: {
      name: 'install_skill',
      description: `Install an npm package or ClawHub skill. This tool:
1. For npm packages: fetches info from npm registry, runs \`npm install\`, creates a skill file
2. For ClawHub skills: fetches skill metadata from clawhub.ai, downloads the skill bundle, writes SKILL.md

After installation, the skill will be automatically loaded on the next conversation turn (the system prompt includes active skills).

Use this when you need to use a third-party npm package or install a skill from ClawHub (clawhub.ai).

ClawHub skills: pass the skill slug (e.g. \`repo-release-notes\`) as package_name. The tool auto-detects ClawHub skills.`,
      parameters: {
        package_name: {
          type: 'string',
          description:
            'The npm package name or ClawHub skill slug to install (e.g. "dayjs", "cn-time-parser", "@scope/package", or ClawHub slug like "repo-release-notes")',
          required: true,
        },
        description: {
          type: 'string',
          description:
            'Optional description of what the package/skill does. If not provided, it will be fetched from the npm registry or ClawHub.',
          required: false,
        },
        usage_guide: {
          type: 'string',
          description:
            'Optional custom usage guide for the AI. If not provided, it will be auto-generated from the readme or ClawHub SKILL.md. Provide this if the auto-generated guide is insufficient.',
          required: false,
        },
        clawhub: {
          type: 'boolean',
          description:
            "Force ClawHub mode. If true, treats package_name as a ClawHub skill slug. Auto-detected if the package doesn't exist on npm.",
          required: false,
        },
        version: {
          type: 'string',
          description: 'Optional version for ClawHub skill install (defaults to latest).',
          required: false,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      // ── Auto-correction: if input is a string, wrap it ────────────────
      if (typeof input === 'string') {
        input = { package_name: input }
      }

      const packageName = input.package_name as string
      if (!packageName || typeof packageName !== 'string') {
        return {
          success: false,
          output: '',
          error: 'package_name is required (string)',
        }
      }

      const forceClawHub = input.clawhub === true
      const version = input.version as string | undefined

      // ── Auto-detect: try npm first, fall back to ClawHub ──────────────
      const npmInfo = forceClawHub ? null : await fetchNpmPackageInfo(packageName)

      // If npm lookup failed and not forced, try ClawHub
      if (!npmInfo && !forceClawHub) {
        const clawhubInfo = await fetchClawHubSkillInfo(packageName)
        if (clawhubInfo) {
          // It's a ClawHub skill — install from ClawHub
          return installFromClawHub(cwd, packageName, version, clawhubInfo, input)
        }

        return {
          success: false,
          output: '',
          error: `"${packageName}" was not found on npm registry nor on ClawHub. Check the name and try again.`,
        }
      }

      // If forced ClawHub mode
      if (forceClawHub) {
        const clawhubInfo = await fetchClawHubSkillInfo(packageName)
        if (!clawhubInfo) {
          return {
            success: false,
            output: '',
            error: `"${packageName}" was not found on ClawHub.`,
          }
        }
        return installFromClawHub(cwd, packageName, version, clawhubInfo, input)
      }

      // ── npm package install path ──────────────────────────────────────
      const description = (input.description as string) || npmInfo?.description || packageName
      const readme = npmInfo?.readme || ''

      const installError = await runNpmInstall(cwd, packageName)
      if (installError) {
        return {
          success: false,
          output: '',
          error: `npm install failed: ${installError}`,
        }
      }

      const usageGuide = (input.usage_guide as string) || (readme ? extractUsageGuide(readme) : '')

      const skillContent = generateSkillContent(packageName, description, usageGuide)

      const skillsDir = path.resolve(cwd, SKILLS_DIR)
      const skillName = sanitizeSkillName(packageName)
      const skillFilePath = path.join(skillsDir, `${skillName}.md`)

      try {
        fs.mkdirSync(skillsDir, { recursive: true })
        fs.writeFileSync(skillFilePath, skillContent, 'utf-8')
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `Failed to write skill file: ${fmtErr(err)}`,
        }
      }

      const relPath = path.relative(cwd, skillFilePath).replace(/\\/g, '/')

      return {
        success: true,
        output: `Installed npm package "${packageName}" and created skill "${relPath}".

The package is now a project dependency. The skill file contains usage instructions for the AI and will be loaded automatically on the next turn.

To verify: use \`read\` on "${relPath}" to see the skill content.`,
      }
    },
  }
}

/** Install a skill from ClawHub */
async function installFromClawHub(
  cwd: string,
  slug: string,
  version: string | undefined,
  info: { displayName: string; summary: string; latestVersion: string },
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const versionToUse = version || info.latestVersion

  // Download the skill ZIP
  const downloaded = await downloadClawHubSkill(slug, versionToUse)
  if (!downloaded) {
    return {
      success: false,
      output: '',
      error: `Failed to download ClawHub skill "${slug}" (version ${versionToUse}).`,
    }
  }

  const skillsDir = path.resolve(cwd, SKILLS_DIR)
  const skillName = sanitizeSkillName(slug)
  const skillFilePath = path.join(skillsDir, `${skillName}.md`)
  const skillDirPath = path.join(skillsDir, skillName)

  // Find the SKILL.md in the ZIP
  const skillMdEntry = findSkillMdInZip(downloaded.files)

  // Also extract supporting files into a subdirectory
  if (skillMdEntry) {
    // Extract all files into skill subdirectory for supporting files
    try {
      fs.mkdirSync(skillDirPath, { recursive: true })
      for (const [filePath, content] of downloaded.files) {
        // Normalize the path: strip common root directory
        const normalizedPath = normalizeZipPath(filePath, slug)
        if (!normalizedPath || normalizedPath === 'SKILL.md') continue // SKILL.md goes to root
        const fullPath = path.join(skillDirPath, normalizedPath)
        fs.mkdirSync(path.dirname(fullPath), { recursive: true })
        fs.writeFileSync(fullPath, content, 'utf-8')
      }
    } catch (err) {
      // Non-critical: supporting files are optional
      console.warn(
        `[install_skill] Warning: could not extract all supporting files: ${fmtErr(err)}`,
      )
    }

    // Generate skill file (using the SKILL.md content from the ZIP)
    const description = (input.description as string) || info.summary || slug
    const skillContent = generateClawHubSkillContent(
      slug,
      info.displayName,
      description,
      skillMdEntry,
    )

    try {
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(skillFilePath, skillContent, 'utf-8')
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to write skill file: ${fmtErr(err)}`,
      }
    }
  } else {
    // No SKILL.md found in ZIP, generate a wrapper skill
    const description = (input.description as string) || info.summary || slug
    // Collect all extracted content as a markdown reference
    const filesList = Array.from(downloaded.files.keys())
      .map(f => `- ${f}`)
      .join('\n')
    const combinedContent =
      `## Files in this skill\n\n${filesList}\n\n` +
      Array.from(downloaded.files.entries())
        .map(([name, content]) => `### ${name}\n\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``)
        .join('\n\n')

    const skillContent = generateClawHubSkillContent(
      slug,
      info.displayName,
      description,
      combinedContent,
    )

    try {
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.writeFileSync(skillFilePath, skillContent, 'utf-8')
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `Failed to write skill file: ${fmtErr(err)}`,
      }
    }
  }

  const relPath = path.relative(cwd, skillFilePath).replace(/\\/g, '/')
  const supportRelPath = skillMdEntry ? path.relative(cwd, skillDirPath).replace(/\\/g, '/') : ''

  let output = `Installed ClawHub skill "${slug}" (v${versionToUse}) and created skill file "${relPath}".`
  if (supportRelPath) {
    output += `\nSupporting files extracted to "${supportRelPath}/".`
  }
  output += `

The skill instructions will be loaded automatically on the next turn.

To verify: use \`read\` on "${relPath}" to see the skill content.`

  return {
    success: true,
    output,
  }
}

/** Find the SKILL.md entry in the downloaded files (case-insensitive) */
function findSkillMdInZip(files: Map<string, string>): string | null {
  for (const [filePath] of files) {
    const normalized = filePath.replace(/\\/g, '/').toLowerCase()
    if (normalized.endsWith('/skill.md')) {
      return files.get(filePath) || null
    }
  }
  // Fallback: check root-level SKILL.md
  for (const [filePath] of files) {
    const normalized = filePath.replace(/\\/g, '/')
    if (normalized.toLowerCase() === 'skill.md' || normalized.endsWith('/skill.md')) {
      return files.get(filePath) || null
    }
  }
  return null
}

/** Normalize a ZIP file path, stripping common root directory */
function normalizeZipPath(filePath: string, slug: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  // Strip leading directory that matches the slug or is a common root
  const parts = normalized.split('/')
  if (parts.length > 1) {
    // Remove the first segment if it's a common root
    // ZIPs from ClawHub often have a root folder like "repo-release-notes/"
    return parts.slice(1).join('/')
  }
  return normalized
}
