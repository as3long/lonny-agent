import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fmtErr } from './errors.js'
import type { Tool, ToolResult } from './types.js'

// ── Constants ────────────────────────────────────────────────────────────────

const SKILLS_DIR = '.lonny/skills'
const NPM_REGISTRY_URL = 'https://registry.npmjs.org'

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

/** Generate the skill markdown content */
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
      description: `Install an npm package as a skill. This tool:
1. Fetches package info from the npm registry
2. Runs \`npm install\` to add the package as a project dependency
3. Creates a skill file in ${SKILLS_DIR}/ with usage instructions for the AI

After installation, the skill will be automatically loaded on the next conversation turn (the system prompt includes active skills).

Use this when you need to use a third-party npm package that isn't already available.`,
      parameters: {
        package_name: {
          type: 'string',
          description:
            'The npm package name to install (e.g. "dayjs", "cn-time-parser", "@scope/package")',
          required: true,
        },
        description: {
          type: 'string',
          description:
            'Optional description of what the package does. If not provided, it will be fetched from the npm registry.',
          required: false,
        },
        usage_guide: {
          type: 'string',
          description:
            'Optional custom usage guide for the AI. If not provided, it will be auto-generated from the package readme. Provide this if the auto-generated guide is insufficient.',
          required: false,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      const packageName = input.package_name as string
      if (!packageName || typeof packageName !== 'string') {
        return {
          success: false,
          output: '',
          error: 'package_name is required (string)',
        }
      }

      // Step 1: Fetch package info from npm registry
      const npmInfo = await fetchNpmPackageInfo(packageName)
      const description = (input.description as string) || npmInfo?.description || packageName
      const readme = npmInfo?.readme || ''

      // Step 2: Install the npm package
      const installError = await runNpmInstall(cwd, packageName)
      if (installError) {
        return {
          success: false,
          output: '',
          error: `npm install failed: ${installError}`,
        }
      }

      // Step 3: Generate and write the skill file
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
        output: `Installed "${packageName}" and created skill "${relPath}".

The package is now a project dependency. The skill file contains usage instructions for the AI and will be loaded automatically on the next turn.

To verify: use \`read\` on "${relPath}" to see the skill content.`,
      }
    },
  }
}
