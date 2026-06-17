import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'
import { fetchClawHubSkillInfo, installFromClawHub } from './clawhub.js'
import { SKILLS_DIR } from './constants.js'
import { fetchNpmPackageInfo, runNpmInstall } from './npm.js'
import { extractUsageGuide, generateSkillContent, sanitizeSkillName } from './skill-content.js'

export function createInstallSkillTool(cwd: string): Tool {
  return {
    definition: {
      name: 'install_skill',
      category: 'Install',
      group: 'Skill',
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
