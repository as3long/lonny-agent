import type { Edit, SingleEdit } from './types.js'

/** Build diagnostic JSON for error messages */
export function buildDiag(edit: SingleEdit): string {
  return JSON.stringify({
    file_path: edit.file_path,
    old_string: edit.old_string,
    new_string: edit.new_string,
  })
}

/** Summarize raw input for error messages to avoid dumping huge strings into the LLM context. */
export function summarizeRawInput(rawInput: unknown): string {
  const s = JSON.stringify(rawInput)
  if (s.length <= 500) return s
  return `${s.slice(0, 500)}... [truncated, total ${s.length} chars]`
}

/** Export for testing */
export function parseMarkdownEdit(content: string): Edit[] {
  const edits: Edit[] = []

  function parseEditBlock(raw: string): Edit | null {
    // Remove stray ``` lines (model may close the block early before new:)
    const cleaned = raw.replace(/^```\s*$/gm, '')

    const fileMatch = cleaned.match(/^file:\s*(.+)$/m)
    if (!fileMatch) return null
    const filePath = fileMatch[1]!.trim()

    let oldString = ''
    let newString = ''

    const oldMatch = cleaned.match(/^old:(?:\s*\|\d*\s*\n)?([\s\S]*?)^new:/m)
    const newMatch = cleaned.match(/^new:(?:\s*\|\d*\s*\n)?([\s\S]*)$/m)

    if (oldMatch) {
      oldString = oldMatch[1]!.replace(/^\n+/, '').replace(/\n+$/, '')
    }
    if (newMatch) {
      newString = newMatch[1]!.replace(/^\n+/, '').replace(/\n+$/, '')
    }

    return { file_path: filePath, old_string: oldString || '', new_string: newString || '' }
  }

  // Strategy 1: Non-greedy block regex (handles multi-edit, correct formatting)
  const blockRegex = /```edit\s*([\s\S]*?)```/gi
  for (const regexMatch of content.matchAll(blockRegex)) {
    const edit = parseEditBlock(regexMatch[1]!)
    if (edit) edits.push(edit)
  }

  // Strategy 2: If no edit with new_string found (model likely closed ``` before new:),
  // retry with greedy matching to capture everything up to the last ```
  if (!edits.some(e => e.new_string)) {
    edits.length = 0
    const greedyRegex = /```edit\s*([\s\S]*)```/g
    for (const regexMatch of content.matchAll(greedyRegex)) {
      const edit = parseEditBlock(regexMatch[1]!)
      if (edit) edits.push(edit)
    }
  }

  // Strategy 3: No block markers at all — try parsing raw content directly
  if (edits.length === 0) {
    const edit = parseEditBlock(content)
    if (edit) edits.push(edit)
  }

  return edits
}

/** Extract edits from legacy JSON format (backward compatibility) */
export function extractEditsFromJSON(input: Record<string, unknown>): Edit[] {
  // Pattern 0: input is an array (edits passed directly instead of wrapped)
  if (Array.isArray(input)) {
    // Preserve array for validation
    return input as Edit[]
  }

  // Pattern 1: input has file_path, old_string, new_string at top level (missing edits array)
  if (!Array.isArray(input.edits)) {
    const keys = Object.keys(input)

    // Check if the keys look like a single edit object (file_path + old_string + new_string)
    const hasFilePath = typeof input.file_path === 'string'
    const hasOldString = typeof input.old_string === 'string'
    const hasNewString = typeof input.new_string === 'string'

    if (hasFilePath && hasOldString && hasNewString) {
      return [
        {
          file_path: input.file_path as string,
          old_string: input.old_string as string,
          new_string: input.new_string as string,
        },
      ]
    } else if (hasFilePath && hasOldString) {
      // Only file_path + old_string (missing new_string) — use a sentinel
      // value so validation catches this as an error instead of silently deleting content.
      return [
        {
          file_path: input.file_path as string,
          old_string: input.old_string as string,
          new_string: (input.new_string as string) || '__MISSING_NEW_STRING__',
        },
      ]
    } else if (keys.length === 2 && hasFilePath && typeof input.new_string === 'string') {
      // file_path + new_string but no old_string — treat as new file creation
      return [
        {
          file_path: input.file_path as string,
          old_string: '',
          new_string: input.new_string as string,
        },
      ]
    } else if (keys.length === 1 && hasFilePath) {
      // Only file_path — maybe they meant create file with empty content?
      return [{ file_path: input.file_path as string, old_string: '', new_string: '' }]
    }
    return []
  }

  // If edits is an array (even empty), preserve for validation
  if (Array.isArray(input.edits)) {
    return input.edits as Edit[]
  }

  return []
}
