/**
 * Format an unknown error value into a readable string.
 * Replaces the repetitive `err instanceof Error ? err.message : String(err)` pattern.
 */
export function fmtErr(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
