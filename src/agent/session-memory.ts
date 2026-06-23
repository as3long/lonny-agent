import * as path from 'node:path'
import type { ToolCall, ToolResult } from '../tools/types.js'
import { saveMemory } from './memory.js'

// ── Types ──────────────────────────────────────────────────────────────────

interface RecentToolCall {
  name: string
  input: Record<string, unknown>
  output: string
  success: boolean
  timestamp: number
  tcIndex: number // index within the current turn
}

interface PatternDef {
  /** Unique key for deduplication */
  key: string
  /** How many times this pattern was observed */
  count: number
  /** Turn index when first seen */
  firstSeen: number
  /** Turn index when last seen */
  lastSeen: number
  /** The memory content to save if threshold reached */
  memoryContent: string
  /** Tags for the memory entry */
  tags: string[]
  /** Whether memory has already been saved for this pattern */
  saved: boolean
}

// ── Pattern threshold constants ────────────────────────────────────────────

/** How many times a pattern must be observed before auto-saving memory */
const THRESHOLD_ERROR_FIX = 2
const THRESHOLD_DEV_COMMAND = 1 // save immediately
const THRESHOLD_CONVENTION = 3 // need 3+ occurrences to infer a convention

/** Max recent tool calls to keep in rolling window */
const MAX_WINDOW = 30

// ── State ──────────────────────────────────────────────────────────────────

let recentCalls: RecentToolCall[] = []
let turnIndex = 0
let toolIndexInTurn = 0
const patterns: PatternDef[] = []

/**
 * Reset all tracked state. Called at the start of each session/chat.
 */
export function resetAutoMemory(): void {
  recentCalls = []
  turnIndex = 0
  toolIndexInTurn = 0
  patterns.length = 0
}

/**
 * Increment turn counter. Call at the start of each turn in the chat loop.
 */
export function startTurn(): void {
  turnIndex++
  toolIndexInTurn = 0
}

/**
 * Process a single tool call result for auto-memory detection.
 * Call this after each tool call is executed in the chat loop.
 *
 * @param tc - Tool call that was dispatched
 * @param result - Result from the tool
 * @param cwd - Project working directory (for saving memory)
 */
export function processToolCall(tc: ToolCall, result: ToolResult, cwd: string): void {
  // Stash cwd for use by saveAutoMemory
  lastCwd = cwd
  toolIndexInTurn++

  // Record the tool call
  const record: RecentToolCall = {
    name: tc.name,
    input: tc.input as Record<string, unknown>,
    output: result.output || '',
    success: result.success,
    timestamp: Date.now(),
    tcIndex: toolIndexInTurn,
  }
  recentCalls.push(record)

  // Trim window
  if (recentCalls.length > MAX_WINDOW) {
    recentCalls = recentCalls.slice(-MAX_WINDOW)
  }

  if (!result.success) return

  // ── Detect patterns ────────────────────────────────────────────────────

  detectErrorFixPattern(tc, result, cwd)
  detectDevCommandPattern(tc, result, cwd)
  detectConventionPattern(tc, result, cwd)
}

/**
 * Pattern 1: Error/Fix detection.
 * If bash output shows compilation/lint errors and a subsequent edit
 * modifies related files, remember the fix approach.
 */
function detectErrorFixPattern(tc: ToolCall, result: ToolResult, cwd: string): void {
  if (tc.name !== 'bash' && tc.name !== 'edit') return

  const output = result.output

  if (tc.name === 'bash') {
    // Detect error messages in bash output
    const errorPatterns = [
      /\berror\s+TS\d+/i, // TypeScript errors
      /\bFAIL\b/i, // Test failures
      /\bSyntaxError\b/i,
      /\bModule\s+not\s+found\b/i,
      /\bcannot\s+find\s+module\b/i,
      /\bis\s+not\s+a\s+function\b/i,
      /\bcannot\s+read\s+property\b/i,
      /\bis\s+not\s+defined\b/i,
      /\bunexpected\s+token\b/i,
      /\bfailed\s+to\s+compile\b/i,
      /\bcompilation\s+error\b/i,
      /\btest\s+failed\b/i,
      /\bexpected\b.*\breceived\b/i,
    ]

    for (const pattern of errorPatterns) {
      const match = output.match(pattern)
      if (match) {
        // Extract the error type and file/line info for a useful memory key
        const errorType = match[0].slice(0, 60)
        const lines = output.split('\n')
        // Try to get more context: look for file paths near the error
        const fileRefs = lines
          .filter(l => /\.(ts|js|tsx|jsx|vue|css|scss):\d+/.test(l))
          .map(l => l.trim().slice(0, 80))

        let memoryContent = `Error pattern detected: ${errorType}`
        if (fileRefs.length > 0) {
          memoryContent += `\nRelated files: ${fileRefs.slice(0, 3).join(', ')}`
        }

        upsertPattern({
          key: `error:${errorType}`,
          memoryContent,
          tags: ['auto', 'error-pattern'],
        })
        return // one pattern per call is enough
      }
    }
  }

  if (tc.name === 'edit' && result.success) {
    // Check if this edit follows a recent error
    // Look back at the last few calls for error-related bash commands
    const recentErrors = recentCalls
      .slice(-5, -1) // exclude current call
      .filter(c => c.name === 'bash' && /error|fail|syntax|not found|not defined/i.test(c.output))

    if (recentErrors.length > 0) {
      // We have an error → edit sequence
      const filePath =
        (tc.input.file_path as string) ||
        ((tc.input.edits as Array<Record<string, unknown>> | undefined)?.[0]
          ?.file_path as string) ||
        ''

      if (filePath) {
        // Extract what was changed (briefly)
        const newStr = (tc.input.new_string as string) || ''
        const oldStr = (tc.input.old_string as string) || ''
        const changePreview = newStr.split('\n')[0]?.trim().slice(0, 80) || ''

        const memoryContent = `Fix for ${path.basename(filePath)}: ${changePreview}`
        upsertPattern({
          key: `fix:${path.basename(filePath)}:${changePreview.slice(0, 40)}`,
          memoryContent: `## Error Fix\n\nWhen encountering errors in \`${path.basename(filePath)}\`:\n- **File**: \`${filePath}\`\n- **Fix**: ${changePreview}\n\nThis fix was applied after errors were detected.`,
          tags: ['auto', 'error-fix'],
        })
      }
    }
  }
}

/**
 * Pattern 2: Dev server / startup commands.
 * Detect when the user runs dev servers or build watchers.
 */
function detectDevCommandPattern(tc: ToolCall, result: ToolResult, cwd: string): void {
  if (tc.name !== 'bash') return

  const command = (tc.input.command as string) || ''

  const devPatterns = [
    /\bnpm\s+run\s+(dev|start|serve|watch|develop)\b/i,
    /\byarn\s+(dev|start|serve|watch|develop)\b/i,
    /\bpnpm\s+(dev|start|serve|watch|develop)\b/i,
    /\bnpx\s+(serve|http-server|live-server)\b/i,
    /\bnodemon\b/i,
    /\bvite\b/i,
    /\bvue-cli-service\s+serve\b/i,
    /\bng\s+serve\b/i,
  ]

  for (const pattern of devPatterns) {
    if (pattern.test(command)) {
      upsertPattern({
        key: `dev:${command.slice(0, 60)}`,
        memoryContent: `## Development Server\n\nThis project uses \`${command}\` to start the dev server.`,
        tags: ['auto', 'dev-command'],
      })
      return
    }
  }
}

/**
 * Pattern 3: Project conventions.
 * Detect consistent naming patterns in edited/new files.
 */
function detectConventionPattern(tc: ToolCall, result: ToolResult, cwd: string): void {
  if (tc.name !== 'edit' && tc.name !== 'read') return

  // Extract file paths from the tool call
  let filePaths: string[] = []

  if (tc.name === 'edit') {
    const edits = (tc.input as Record<string, unknown>).edits as
      | Array<Record<string, unknown>>
      | undefined
    if (edits) {
      for (const e of edits) {
        const fp = e.file_path as string | undefined
        if (fp) filePaths.push(fp)
      }
    } else {
      const fp = (tc.input as Record<string, unknown>).file_path as string | undefined
      if (fp) filePaths.push(fp)
    }
  } else if (tc.name === 'read') {
    const paths = (tc.input as Record<string, unknown>).paths as string[] | undefined
    if (paths) filePaths = paths
  }

  for (const fp of filePaths) {
    const basename = path.basename(fp, path.extname(fp))

    // Detect I* interface naming (e.g. IUserService)
    if (/^I[A-Z]/.test(basename)) {
      upsertPattern({
        key: `convention:I-prefix`,
        memoryContent: `## Naming Convention\n\nThis project uses \`I\`-prefix for interfaces (e.g. \`${basename}\`).`,
        tags: ['auto', 'naming-convention'],
      })
    }

    // Detect PascalCase files (component files)
    if (/^[A-Z][a-z]+[A-Z]/.test(basename)) {
      upsertPattern({
        key: `convention:PascalCase`,
        memoryContent: `## Naming Convention\n\nThis project uses PascalCase for component files (e.g. \`${basename}\`).`,
        tags: ['auto', 'naming-convention'],
      })
    }

    // Detect kebab-case files
    if (/^[a-z]+(-[a-z]+)+$/.test(basename)) {
      upsertPattern({
        key: `convention:kebab-case`,
        memoryContent: `## Naming Convention\n\nThis project uses kebab-case for file names (e.g. \`${basename}\`).`,
        tags: ['auto', 'naming-convention'],
      })
    }

    // Detect test files
    if (/\.(test|spec|e2e)\.(ts|js|tsx|jsx)$/i.test(fp)) {
      upsertPattern({
        key: `convention:test-files`,
        memoryContent: `## Test Convention\n\nTest files follow the pattern \`*.test.*\` or \`*.spec.*\` (e.g. \`${path.basename(fp)}\`).`,
        tags: ['auto', 'naming-convention'],
      })
    }
  }
}

// ── Pattern management ─────────────────────────────────────────────────────

/**
 * Add or update a detected pattern.
 * If threshold is reached and memory not yet saved, auto-save to .lonny/memory/.
 */
function upsertPattern(def: { key: string; memoryContent: string; tags: string[] }): void {
  let p = patterns.find(p => p.key === def.key)

  if (p) {
    p.count++
    p.lastSeen = turnIndex
    // Update memory content in case we have more context now
    p.memoryContent = def.memoryContent
  } else {
    p = {
      key: def.key,
      count: 1,
      firstSeen: turnIndex,
      lastSeen: turnIndex,
      memoryContent: def.memoryContent,
      tags: def.tags,
      saved: false,
    }
    patterns.push(p)
  }

  // Determine threshold based on tags
  let threshold = 3 // default
  if (def.tags.includes('error-fix') || def.tags.includes('error-pattern')) {
    threshold = THRESHOLD_ERROR_FIX
  } else if (def.tags.includes('dev-command')) {
    threshold = THRESHOLD_DEV_COMMAND
  } else if (def.tags.includes('naming-convention')) {
    threshold = THRESHOLD_CONVENTION
  }

  // Auto-save if threshold reached and not yet saved
  if (p.count >= threshold && !p.saved) {
    p.saved = true
    saveAutoMemory(def.memoryContent, def.tags)
  }
}

/**
 * Save a memory entry to the project's .lonny/memory/ directory.
 */
function saveAutoMemory(content: string, tags: string[]): void {
  try {
    // We need the cwd. Since this is called from processToolCall which has it,
    // we stash it. Actually, let's find the cwd from the recent calls context.
    // Better: store cwd in module state.
    // For now, use the stored recent cwd or fall back to process.cwd()
    const cwd = lastCwd || process.cwd()
    const id = `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const entry = {
      id,
      createdAt: new Date().toISOString(),
      content,
      tags: [...tags, 'auto-saved'],
    }
    saveMemory(cwd, entry)
  } catch {
    // Silently ignore memory save failures
  }
}

/** Last known cwd (stashed from processToolCall) */
let lastCwd = ''
