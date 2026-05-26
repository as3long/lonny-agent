## Plan

Add a split-panel TUI to display a plan list (`.lonny/*.md` files) and a todo list (parsed from the selected plan) on the right side of the terminal. The current readline-based TUI in `src/index.ts` will be replaced with a blessed-based full-screen layout.

### Architecture

**Layout (using `blessed`):**
```
+-----------------------------------+----------+
|                                   | Plans    |
|         Chat Area                 |----------|
|     (scrollable log)              | Todos    |
|                                   |          |
+-----------------------------------+----------+
|  > You  [input line]                        |
+---------------------------------------------+
```

- **Left panel** (`chat-box`): displays the conversation history (user messages, assistant responses, tool calls/results) — replaces current `process.stdout.write` / `console.error` output.
- **Right top panel** (`plans-box`): lists plan files found under `.lonny/`. Each item is a filename. Clicking/selecting loads its content.
- **Right bottom panel** (`todos-box`): shows parsed todo items (`- [ ]` / `- [x]`) from the currently selected plan file.
- **Bottom input bar**: a text input replacing `readline.question`.

### Files to create / modify

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `blessed` and `@types/blessed` dependencies |
| `src/tui/index.ts` | Create | Main TUI setup — blessed screen, layout, event loop |
| `src/tui/plans-panel.ts` | Create | Scans `.lonny/` for `*.md` files, renders list, supports selection |
| `src/tui/todo-panel.ts` | Create | Parses markdown todo items from a plan file, renders checklist |
| `src/index.ts` | Modify | Replace readline `tuiLoop` with new TUI module call |
| `src/tools/write_plan.ts` | Modify | Export `PLAN_DIR` constant and optionally accept a refresh callback |

### Key implementation details

1. **`src/tui/index.ts`** — Exports a `startTui(config)` async function. It:
   - Creates a blessed `Screen` with `smartCSR: true, title: 'lonny'`.
   - Constructs the layout:
     - `chatBox` (left 70%): `scrollable: true, alwaysScroll: true, scrollbar: true`
     - `plansBox` (right 30%, top half): `scrollable: true, items: [...]`
     - `todosBox` (right 30%, bottom half): `scrollable: true, items: [...]`
     - `inputBox` (bottom): a `Textbox` for user input
   - Calls `plansPanel.scan()` on startup and after each `session.chat()`.
   - Replaces all `process.stdout.write` / `console.error` calls with `chatBox.setContent()` + `screen.render()`.
   - Returns when user types `/exit` or `/quit`.

2. **`src/tui/plans-panel.ts`** — Exports a `PlansPanel` class:
   - `scan()`: reads `fs.readdirSync(path.resolve(cwd, '.lonny'))` filtered for `.md` files, sorted by mtime descending.
   - `render()`: formats the list for `plansBox.setItems(...)`.
   - Fires a `select` event when a plan is clicked, which triggers `todosPanel.loadPlan(filePath)`.

3. **`src/tui/todo-panel.ts`** — Exports a `TodosPanel` class:
   - `loadPlan(filePath)`: reads the markdown file, extracts lines matching `- [ ] ...` and `- [x] ...` using regex.
   - `render()`: formats checklist items for `todosBox.setItems(...)`.

4. **Integration with session**:
   - The TUI creates a `Session` instance (same as today).
   - User types in `inputBox`, on submit the prompt is sent to `session.chat()`.
   - During `session.chat()`, the agent may call `write_plan`. After `chat()` returns, the TUI calls `plansPanel.scan()` to refresh.
   - All streaming output from the LLM and tool results is appended to `chatBox`.

### Additional changes made during implementation

- **`src/agent/session.ts`**: Added `SessionOutput` interface (`write` + `error` callbacks) and optional `output` parameter to `Session` constructor. All `process.stdout.write`/`console.error` calls were refactored to use `writeOut()`/`writeErr()` helpers that check for the output handler. This avoids hacking `process.stdout` (which would break blessed rendering) and keeps the non-TUI `runAgent()` path clean.

### Risks and edge cases

- **Windows compatibility**: `blessed` uses `tput` and terminfo; on Windows it falls back to `win32` backend. Need to test with Windows Terminal and PowerShell.
- **No `.lonny/` directory**: If no plans exist, the plans panel shows a placeholder ("No plans yet"). The directory is created on first `write_plan` call.
- **Concurrent output**: The streaming LLM response appends to `chatBox` incrementally. Since blessed uses an internal buffer and `screen.render()`, this is safe.
- **Non-TUI mode**: The `runAgent()` one-shot mode (no TUI) must remain unaffected. The TUI code is only invoked from `tuiLoop`.
- **Resize handling**: Blessed handles terminal resizes automatically via `screen.on('resize', ...)`.

## Todo List

- [x] **Step 1**: Install dependencies — run `npm install blessed @types/blessed`
- [x] **Step 2**: Create `src/tui/index.ts` — main TUI module: blessed screen setup, layout (chat panel left, plans+todos panels right, input bottom), event loop replacing readline
- [x] **Step 3**: Create `src/tui/plans-panel.ts` — scans `.lonny/*.md`, renders scrollable list, supports selection via click/keyboard
- [x] **Step 4**: Create `src/tui/todo-panel.ts` — parses `- [ ]`/`- [x]` items from a plan markdown file, renders checklist
- [x] **Step 5**: Modify `src/index.ts` — replace the readline-based `tuiLoop` with the new blessed TUI; keep `runAgent()` one-shot mode unchanged
- [x] **Step 6**: Modify `src/tools/write_plan.ts` — export `PLAN_DIR` constant for reuse by the TUI; optionally wire a refresh callback so plans panel auto-updates after a plan write
- [x] **Step 7**: Build and test — run `npm run build`, then `npm run dev` to verify the TUI renders correctly and panels update on `/mode plan` chat cycles
