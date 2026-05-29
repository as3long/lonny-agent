# Plan: Fix /new Command Session Cleanup Issues

## Analysis

Reviewing `src/tui/index.ts` lines 485-496, the `/new` command has two issues:

### Issue 1: No `session.stop()` when agent is running

The slash command handler intentionally allows all commands even when `isRunning === true` (see comment on line 471: "Allow slash commands even when agent is running (critical for /stop)"). However, `/new` creates a **new** `Session` object while the **old** session's `session.chat()` promise may still be in-flight:

- The old session continues consuming API tokens via its pending LLM stream
- When the old `chat()` promise resolves, it writes to `chatContent` via the `output.write` closure — but `chatContent` was just cleared by `/new`, causing stale output to pollute the fresh chat display
- The old promise's `.then()` callback sets `isRunning = false` and calls `updateFooter()` etc. (harmless but messy)

### Issue 2: Editor internal state not fully reset

`editor.setText('')` (called at line 468 before the slash command handler) resets the text, cursor, and `scrollOffset`. But it does NOT clear:

- `undoStack` — pressing Ctrl+Z after `/new` could restore old session content
- `history` (command history for up/down navigation) — old commands linger
- `killRing` (Emacs kill/yank ring) — old killed text is still accessible

The Editor class declares these as `private` (see `editor.d.ts` lines 57-59, 64), so we need `(editor as any)` casts to access them at runtime.

## Fix

Edit `src/tui/index.ts` lines 485-496, replacing the `/new` handler with:

```typescript
if (cmd === 'new') {
  // If the agent is running, stop the old session gracefully first.
  // Without this, the pending chat() promise would continue consuming
  // tokens and write stale output into the freshly cleared chat display.
  if (isRunning) {
    session.stop()
    isRunning = false
    loader.setMessage('')
    tui.setShowHardwareCursor(true)
  }
  Session.clearSavedSession(config.cwd)
  resetTokenUsage(config.cwd)
  resetGlobalEventBus()
  session = new Session(config, output)
  session.onPlanWritten = planCb
  chatContent = ''
  chatMarkdown.setText('')
  plansList.clearFilter()
  // Reset editor internal state that setText('') doesn't clear
  ;(editor as any).undoStack.clear()
  ;(editor as any).history = []
  ;(editor as any).killRing = new (require('@earendil-works/pi-tui').KillRing)()
  updateFooter()
  return
}
```

> **Note about `KillRing` import**: The `KillRing` class is internal to pi-tui and not exported in the public types. Using `require('@earendil-works/pi-tui').KillRing` at runtime works because the package exports it internally. An alternative is to just set `(editor as any).killRing = { length: 0, ring: [], push: () => {}, peek: () => null, rotate: () => {} }` as a mock.

> **Actual implementation**: Used `(editor as any).killRing.ring = []` instead of replacing the whole KillRing instance — simpler and avoids ESM `require` issues.

## Todo List

- [x] Replace the `/new` command handler in `src/tui/index.ts` (around line 485) with the version above that calls `session.stop()` if running and resets editor internal state
- [x] Run `npm run build` to verify compilation
- [x] Test: start agent, let it run, type `/new`, verify no stale output appears and editor history/undo is clean
