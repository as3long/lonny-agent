import * as fs from 'node:fs'
import * as path from 'node:path'
import { Tool, ToolResult } from './types.js'
import { parsePatch } from '../diff/parser.js'
import { PatchApplier } from '../diff/apply.js'

export function createBatchEditTool(applier: PatchApplier, cwd: string, autoApprove: boolean): Tool {
  return {
    definition: {
      name: 'batch_edit',
      description: `Apply ALL file edits at once using a compact diff format. This is the ONLY tool for making file changes.

Format:
@ <path>              - update existing file
@ <path>:create       - create new file
@ <path>:delete       - delete file
@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@  - hunk header
  (space prefix)      - context line
-                     - line to remove
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
        return {
          success: false,
          output: '',
          error: `Patch parsing errors:\n${errors.join('\n')}`,
        }
      }

      if (patch.changes.length === 0) {
        return { success: false, output: '', error: 'No changes found in patch' }
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
          return `  ${r.operation.toUpperCase()} ${r.path}: FAILED - ${r.error}`
        })
        return { success: false, output: '', error: `Batch edit failed:\n${lines.join('\n')}` }
      }
    },
  }
}

