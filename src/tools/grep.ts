import { execSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { fmtErr } from './errors.js'

function hasRg(): boolean {
  try {
    execSync('rg --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

/** Simple glob-to-regex for the `include` parameter (e.g. "*.ts", "*.{ts,tsx}"). */
function includeRe(include: string): RegExp {
  let re = ''
  let i = 0
  while (i < include.length) {
    const ch = include[i]
    if (ch === '.') { re += '\\.'; i++; continue }
    if (ch === '*') {
      if (include[i + 1] === '*') { re += '.*'; i += 2; continue }
      re += '[^/]*'; i++; continue
    }
    if (ch === '{') {
      const end = include.indexOf('}', i)
      if (end !== -1) {
        const parts = include.slice(i + 1, end).split(',')
        re += '(?:' + parts.map(p => p.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')).join('|') + ')'
        i = end + 1; continue
      }
    }
    if (ch === '?') { re += '.'; i++; continue }
    re += ch; i++
  }
  return new RegExp(re + '$')
}

interface NodeGrepMatch { file: string; line: number; text: string }

async function nodeGrep(dir: string, re: RegExp, incRe: RegExp | null): Promise<NodeGrepMatch[]> {
  const results: NodeGrepMatch[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const subResults: Promise<NodeGrepMatch[]>[] = []
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === '.git' || e.name === 'node_modules') continue
        subResults.push(nodeGrep(full, re, incRe))
      } else if (e.isFile()) {
        if (incRe && !incRe.test(e.name)) continue
        try {
          const content = await fs.readFile(full, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              results.push({ file: full, line: i + 1, text: lines[i] })
            }
          }
        } catch { /* permission denied etc */ }
      }
    }
    // Await all subdirectory results concurrently
    const subMatches = await Promise.all(subResults)
    for (const sm of subMatches) {
      results.push(...sm)
    }
  } catch { /* permission denied etc */ }
  return results
}

export function createGrepTool(cwd: string): Tool {
  const useRg = hasRg()

  return {
    definition: {
      name: 'grep',
      description: 'Search file contents using a regular expression. Supports full regex syntax.',
      parameters: {
        pattern: { type: 'string', description: 'Regex pattern to search for', required: true },
        include: { type: 'string', description: 'File glob pattern to filter (e.g. "*.ts")' },
        path: { type: 'string', description: 'Directory to search in (default: cwd)' },
      },
    },
    async execute(input): Promise<ToolResult> {
      const pattern = input.pattern as string
      if (!pattern) {
        return { success: false, output: '', error: 'pattern is required' }
      }

      const include = input.include as string | undefined
      const searchPath = input.path as string | undefined || cwd

      try {
        if (useRg) {
          let cmd = `rg -n "${pattern.replace(/"/g, '\\"')}"`
          if (include) cmd += ` -g "${include}"`
          cmd += ` "${searchPath}"`
          const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
          return { success: true, output: output || 'No matches found.' }
        }

        const re = new RegExp(pattern)
        const incRe = include ? includeRe(include) : null
        const matches = await nodeGrep(searchPath, re, incRe)

        if (matches.length === 0) {
          return { success: true, output: 'No matches found.' }
        }

        const output = matches
          .map(m => `${path.relative(cwd, m.file).replace(/\\/g, '/')}:${m.line}:${m.text}`)
          .join('\n')
        return { success: true, output }
      } catch (err) {
        const msg = fmtErr(err)
        if (useRg && msg.includes('exit code 1')) {
          return { success: true, output: 'No matches found.' }
        }
        return { success: false, output: '', error: `Grep failed: ${msg}` }
      }
    },
  }
}
