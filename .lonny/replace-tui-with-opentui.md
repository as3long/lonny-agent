# Plan: Replace Custom ANSI TUI with OpenTUI

## Overview

Replace the hand-rolled raw-ANSI-escape TUI in `src/tui/` with `@opentui/core` (v0.2.15), a
TypeScript-native TUI library with a Zig core, flexbox layout (via yoga-layout), and
built-in components for text, input, scrolling, selection, markdown rendering, etc.

## Files to Modify

| File | Action |
|------|--------|
| `src/tui/index.ts` | Rewrite — use OpenTUI components instead of raw ANSI rendering |
| `src/tui/plans-panel.ts` | Delete — replaced by `SelectRenderable` |
| `src/tui/todo-panel.ts` | Delete — replaced by `TextRenderable` |
| `package.json` | Add `@opentui/core` dependency (already installed for analysis) |

## New Layout Architecture (flexbox via yoga-layout)

```
Root (flexDirection: column, width: 100%, height: 100%)
 ├─ MainContent (flexGrow: 1, flexDirection: row)
 │   ├─ ChatScrollBox (flexGrow: 1)          ← left panel ~70%
 │   │   └─ MarkdownRenderable (chat output)
 │   └─ SidePanel (width: 30%, flexDirection: column, visible only when cols≥100)
 │       ├─ PlansSelect (SelectRenderable, flexGrow: 1)
 │       └─ TodoPanel (BoxRenderable, flexGrow: 1)
 │           └─ MarkdownRenderable / TextRenderable (todo list content)
 ├─ InputBar (height: 1)
 │   └─ InputRenderable (single-line text input)
 └─ StatusBar (height: 1, flexDirection: row)
     └─ TextRenderable (status info: running/idle, mode, plan count)
```

## Detailed Steps

### Step 1 — Install OpenTUI dependency
- Ensure `@opentui/core@0.2.15` is in `package.json` `dependencies`
- Run `npm install` to verify native binaries work on win32 x64

### Step 2 — Rewrite `src/tui/index.ts`
- Import OpenTUI:
  ```ts
  import { createCliRenderer, CliRenderer, BoxRenderable, TextRenderable,
           InputRenderable, ScrollBoxRenderable, SelectRenderable,
           MarkdownRenderable, SyntaxStyle, RGBA } from '@opentui/core'
  import { t, green, yellow, cyan, gray, bold } from '@opentui/core'
  ```
- Replace `startTui()` function body:
  1. Call `const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true })`
  2. Create `SyntaxStyle` instance for markdown coloring
  3. Build the component tree:
     - `root = renderer.root` (RootRenderable)
     - Create `ScrollBoxRenderable` for left chat area → contains `MarkdownRenderable` for session output
     - Create `SelectRenderable` for plans list (right panel top half)
     - Create `BoxRenderable` with `TextRenderable` for todos (right panel bottom half)
     - Create `InputRenderable` for user input (bottom)
     - Create `BoxRenderable` with `TextRenderable` for status bar
  4. Wire up input handling:
     - Subscribe to `InputRenderableEvents.ENTER` → handle user message or `/command`
     - Handle `/mode`, `/exit`, `/quit` commands internally
     - Forward non-command text to `session.chat()`
  5. Wire up session output:
     - `SessionOutput.write` appends to markdown renderable content (with `streaming: true`)
     - On session completion, set `streaming: false` and refresh plans
  6. Wire up plans selection:
     - Subscribe to `SelectRenderableEvents.SELECTION_CHANGED`
     - On change, parse selected plan file and update todo panel
  7. Remove ALL raw ANSI code (ALT_ON/OFF, MOUSE_ON/OFF, HOME/SHOW/HIDE, color constants, manual render logic, manual input parsing, mouse handling, resize handling, etc.)
  8. Keep `setOnPlanWritten` callback to refresh the select renderable's options

### Step 3 — Delete `src/tui/plans-panel.ts`
- Replace with `SelectRenderable` in `src/tui/index.ts`
- The plan list still reads from `.lonny/` directory via `fs.readdirSync`
- Populate `SelectRenderable.options` with `{ name, description }` for each plan

### Step 4 — Delete `src/tui/todo-panel.ts`
- Replace with a `BoxRenderable` + `TextRenderable` or `MarkdownRenderable` in `src/tui/index.ts`
- Parsing logic for markdown todo items can be inlined or kept as a helper function
- When a plan is selected, read the file, extract the todo list, update the text renderable

### Step 5 — Test the migration
- Run `npm run dev` (which does `tsx src/index.ts`) to verify the TUI starts
- Verify: alt-screen mode, mouse support, keyboard input, split layout, plan list, todo display
- Run `npm run dev -- --prompt "hello"` to test non-TUI agent mode (unchanged)

## Risks & Edge Cases

1. **Native binary compatibility**: `@opentui/core` ships Zig native binaries. Verify they load on Windows x64. If `createCliRenderer()` throws, we may need a fallback.
2. **MarkdownRenderable streaming**: The `MarkdownRenderable` supports `streaming: true` for incremental LLM output. We must set this to `false` once the response is complete to finalize trailing tokens.
3. **Side panel visibility**: Only show right panel when terminal width ≥ 100 columns (matching current behavior). Use `visible` property toggle or conditional child addition.
4. **Color scheme**: OpenTUI uses `RGBA` objects and supports terminal palette detection. Use `renderer.getPalette()` to adapt colors, or keep using explicit hex colors that match the current scheme.
5. **Input intercept for /commands**: `InputRenderable` emits `ENTER` via `InputRenderableEvents.ENTER`. The handler must check for leading `/` and route to command handling instead of sending to the session.
6. **SessionOutput.write threading**: LLM streaming may call `write` from async context; OpenTUI's `requestRender()` is safe to call from any context, but content updates should be batched via `MarkdownRenderable.content = cumulativeText` (or append via chunks if API supports it).
