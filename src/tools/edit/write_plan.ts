import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fmtErr } from '../errors.js'
import type { Tool, ToolResult } from '../types.js'

/** Directory where plans are stored, relative to project root */
export const PLAN_DIR = '.lonny'

/** Maximum plan content size (1MB) */
const MAX_CONTENT_SIZE = 1_000_000

function sanitizeFilename(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return ''
  // Reject absolute paths (unix /foo or windows C:\foo) up front.
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || /^[a-zA-Z]:/.test(trimmed)) return ''
  // Reject path traversal.
  if (trimmed.includes('..')) return ''
  // Normalize separators and strip any leading ".lonny/" the model may add.
  const normalized = trimmed
    .replace(/\\/g, '/')
    .replace(/^\.lonny\//, '')
    .replace(/^\/+/, '')
  if (!normalized || normalized === '.') return ''
  return normalized
}

export function createWritePlanTool(
  cwd: string,
  onPlanWritten?: (display: string) => void | Promise<void>,
): Tool {
  return {
    definition: {
      name: 'write_plan',
      category: 'Edit',
      group: 'Plan',
      description: `Write a plan/todo document to the project's "${PLAN_DIR}/" folder. Use this in plan mode to persist the generated plan. The file is always created under "${PLAN_DIR}/" relative to the working directory; do NOT include the folder prefix in filename. Existing files with the same name will be overwritten.`,
      parameters: {
        filename: {
          type: 'string',
          description:
            'File name (e.g. "plan.md" or "feature-x/plan.md"). Must NOT be absolute or contain "..". Will be placed under .lonny/.',
          required: true,
        },
        file: {
          type: 'string',
          description: 'Alias for filename (e.g. "plan.md"). One of filename or file is required.',
          required: false,
        },
        content: {
          type: 'string',
          description:
            'Full markdown content of the plan, including the Plan section and Todo List.',
          required: true,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      // Accept both "filename" and "file" parameters (backward compatibility)
      let filename = input.filename
      if (typeof filename !== 'string' || !filename) {
        filename = input.file
      }
      if (typeof filename !== 'string' || !filename) {
        return {
          success: false,
          output: '',
          error:
            'filename is required (string). Use write_plan({ filename: "plan.md", content: "..." }) or write_plan({ file: "plan.md", content: "..." })',
        }
      }
      if (typeof input.content !== 'string') {
        return { success: false, output: '', error: 'content is required (string)' }
      }

      const content = input.content

      // Check content size
      if (content.length > MAX_CONTENT_SIZE) {
        return {
          success: false,
          output: '',
          error: `Content too large (max ${MAX_CONTENT_SIZE} bytes)`,
        }
      }

      const safeName = sanitizeFilename(filename)
      if (!safeName) {
        return {
          success: false,
          output: '',
          error: `Invalid filename: "${filename}". Use a relative name without ".." or absolute paths.`,
        }
      }

      const planDir = path.resolve(cwd, PLAN_DIR)
      const target = path.resolve(planDir, safeName)
      const rel = path.relative(planDir, target)
      if (rel.startsWith('..') || path.isAbsolute(rel) || rel === '') {
        return { success: false, output: '', error: 'Resolved path escapes .lonny/ directory.' }
      }

      try {
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, content, 'utf8')
        const display = path.relative(cwd, target).replace(/\\/g, '/')
        await Promise.resolve(onPlanWritten?.(display))
        return {
          success: true,
          output: `Wrote plan to ${display} (${Buffer.byteLength(content, 'utf8')} bytes)`,
        }
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `Failed to write plan: ${fmtErr(err)}`,
        }
      }
    },
  }
}
