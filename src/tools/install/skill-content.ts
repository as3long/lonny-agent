import { CLAWHUB_SITE } from './constants.js'

/** Sanitize a package name to a valid skill name (lowercase, digits, hyphens) */
export function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/@/g, '')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Generate a usage guide snippet from the readme */
export function extractUsageGuide(readme: string): string {
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
export function generateSkillContent(
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
export function generateClawHubSkillContent(
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

${summary || `ClawHub skill: ${slug}`}

`

  if (clawhubContent) {
    content += `${clawhubContent}\n`
  }

  content += `
## Notes

- This skill was installed from [ClawHub](${CLAWHUB_SITE}/${slug}).
- Source: ${CLAWHUB_SITE}/${slug}
- The skill instructions are loaded automatically on the next turn.
`

  return content
}
