import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { parsePatch } from '../diff/parser.js'
import { PatchApplier } from '../diff/apply.js'

const GY = '\x1b[90m'
const RE = '\x1b[31m'
const RS = '\x1b[0m'

function previewPatch(patchText: string, maxChars = 400): string {
  if (patchText.length <= maxChars) return patchText
  return patchText.slice(0, maxChars) + `\n…(${patchText.length - maxChars} more chars)`
}

function dumpPatchToStderr(reason: string, patchText: string): void {
  const banner = `${GY}── batch_edit failed: ${reason} ──${RS}`
  const numbered = patchText.split('\n').map((l, i) => `${GY}${String(i + 1).padStart(4)}│${RS} ${l}`).join('\n')
  process.stderr.write(`\n${RE}${banner}${RS}\n${numbered}\n${GY}── end patch_text (${patchText.length} chars) ──${RS}\n`)
}

export function createBatchEditTool(applier: PatchApplier, cwd: string, autoApprove: boolean): Tool {
  return {
    definition: {
      name: 'batch_edit',
      description: `Create or delete files. For editing existing files, use the \`edit\` tool instead (simpler, no line numbers, supports batch via the \`edits\` array).

The "@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@" hunk header line numbers MUST be exact and match the file as last shown by \`read\` (whose output prefixes every line with "<lineNumber>: "). There is NO fuzzy search — wrong line numbers will fail the patch.

Format:
@ <path>              - update existing file
@ <path>:create       - create new file
@ <path>:delete       - delete file
@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@  - hunk header
  (space prefix)      - context line (must match the file exactly)
-                     - line to remove (must match the file exactly)
+                     - line to add

Example:
@ src/index.ts
@@ -3,5 +3,7 @@
 const x = 1
 const y = 2
+const z = 3
 function foo() {
-  return x + y
+  return x + y + z
 }

@ src/utils.ts:create
+export function add(a: number, b: number) {
+  return a + b
+}

@ src/old.ts:delete`,
      parameters: {
        patch_text: {
          type: 'string',
          description: 'The compact diff describing ALL file changes',
          required: true,
        },
      },
    },
    async execute(input): Promise<ToolResult> {
      const patchText = input.patch_text as string
      if (!patchText) {
        return { success: false, output: '', error: 'patch_text is required' }
      }

      const { patch, errors } = parsePatch(patchText)

      if (errors.length > 0) {
        dumpPatchToStderr('parse errors', patchText)
        return {
          success: false,
          output: '',
          error: `Patch parsing errors:\n${errors.join('\n')}\n\nReceived patch_text (first 400 chars):\n${previewPatch(patchText)}`,
        }
      }

      if (patch.changes.length === 0) {
        const hints: string[] = []
        if (/^```/m.test(patchText)) hints.push('Do NOT wrap patch_text in ``` code fences.')
        if (/^(diff --git|---\s|\+\+\+\s)/m.test(patchText)) hints.push('Do NOT use unified diff headers like "diff --git" / "--- a/" / "+++ b/". Use the compact "@ <path>" header.')
        if (!/^@\s+\S/m.test(patchText)) hints.push('Missing "@ <path>" file header. Every change must start with a line like "@ src/foo.ts" (or ":create" / ":delete").')
        if (/\\r\\n|\\n|\\t/.test(patchText)) hints.push('Do NOT escape newlines as "\\n" or "\\r\\n"; emit real newlines in patch_text.')
        if (/^@\s+([a-zA-Z]:[\\/]|\/)/m.test(patchText)) hints.push('Use a path RELATIVE to the working directory in the "@ <path>" header (e.g. "src/foo.ts"), not an absolute path.')
        const hintBlock = hints.length ? `\nHints:\n- ${hints.join('\n- ')}` : ''
        dumpPatchToStderr('no changes parsed', patchText)
        return { success: false, output: '', error: `No changes found in patch.${hintBlock}\n\nReceived patch_text (first 400 chars):\n${previewPatch(patchText)}` }
      }

      if (!autoApprove) {
        const summary = patch.changes.map(c => {
          if (c.operation === 'delete') return `  DELETE ${c.path}`
          if (c.operation === 'create') return `  CREATE ${c.path}`
          const changes = c.hunks.reduce((acc, h) => {
            const adds = h.lines.filter(l => l.kind === 'add').length
            const dels = h.lines.filter(l => l.kind === 'delete').length
            return { add: acc.add + adds, del: acc.del + dels }
          }, { add: 0, del: 0 })
          return `  UPDATE ${c.path} (+${changes.add}/-${changes.del})`
        }).join('\n')

        const promptText = `Proposed changes:\n${summary}\n\nApprove? (y/N) `

        process.stdout.write(promptText)

        const inputBuffer = new Uint8Array(1024)
        const n = fs.readSync(process.stdin.fd, inputBuffer, 0, inputBuffer.length, null)
        const answer = new TextDecoder().decode(inputBuffer.subarray(0, n)).trim().toLowerCase()

        if (answer !== 'y' && answer !== 'yes') {
          return { success: true, output: 'Changes rejected by user.' }
        }
      }

      const result = applier.apply(patch, cwd)

      if (result.success) {
        const lines = result.results.map(r => {
          return `  ${r.operation.toUpperCase()} ${path.relative(cwd, r.path)}`
        })
        return { success: true, output: `Applied ${result.results.length} change(s):\n${lines.join('\n')}` }
      } else {
        const lines = result.results.map(r => {
          const status = r.status === 'applied' ? 'APPLIED' : r.status === 'rolled back' ? 'ROLLED BACK' : 'FAILED'
          const detail = r.error ? ` - ${r.error}` : r.status === 'error' ? ' - unknown error' : ''
          return `  ${status} ${r.path}${detail}`
        })
        dumpPatchToStderr('apply failed', patchText)
        return { success: false, output: '', error: `Batch edit failed:\n${lines.join('\n')}\n\nReceived patch_text (first 400 chars):\n${previewPatch(patchText)}` }
      }
    },
  }
}

