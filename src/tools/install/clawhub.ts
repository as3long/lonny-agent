import * as fs from 'node:fs'
import * as path from 'node:path'
// @ts-expect-error - adm-zip has no types
import AdmZip from 'adm-zip'
import { fmtErr } from '../errors.js'
import type { ToolResult } from '../types.js'
import { CLAWHUB_API_BASE, SKILLS_DIR } from './constants.js'
import { generateClawHubSkillContent, sanitizeSkillName } from './skill-content.js'

/** Fetch skill info from ClawHub API */
export async function fetchClawHubSkillInfo(
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
export async function downloadClawHubSkill(
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
export function extractZipContent(buffer: Buffer): { files: Map<string, string> } {
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

/** Find the SKILL.md entry in the downloaded files (case-insensitive) */
export function findSkillMdInZip(files: Map<string, string>): string | null {
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
export function normalizeZipPath(filePath: string, _slug: string): string {
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

/** Install a skill from ClawHub */
export async function installFromClawHub(
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
