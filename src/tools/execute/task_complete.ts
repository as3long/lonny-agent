import type { Tool, ToolResult } from '../types.js'

/**
 * A tool the model can call to explicitly signal that the task is complete.
 * In loop mode, this stops the automatic continuation and ends the session.
 */
export const taskCompleteTool: Tool = {
  definition: {
    name: 'task_complete',
    description: `Call this ONLY when you have confirmed at least THREE TIMES that the task is truly complete.

  ⚠️  TRIPLE CONFIRMATION REQUIRED ⚠️
  Before calling this tool, you MUST verify each of the following three checks:

  Check 1 — All requested work is done: Have you addressed every item the user asked for?
  Check 2 — All changes are verified: Did you run the relevant tests / build / commands and confirm they pass?
  Check 3 — No remaining steps: Is there nothing left to do? No pending edits, unverified changes, or unanswered questions?

  Only call this tool after all three checks pass. If any check fails, continue working instead.

  Use this instead of just describing completion in text — calling this tool explicitly signals the system to stop processing.

  Examples:
    - After finishing all requested edits AND verifying they work (all 3 checks pass)
    - After completing a research task AND presenting findings (all 3 checks pass)
    - After a planned task is fully executed AND verified (all 3 checks pass)`,
    parameters: {
      summary: {
        type: 'string',
        description:
          'A brief summary of what was accomplished in this session (include the 3 checks you verified)',
        required: true,
      },
    },
  },
  async execute(input): Promise<ToolResult> {
    const summary = (input.summary as string) || ''
    return { success: true, output: `TASK_COMPLETE: ${summary}` }
  },
}
