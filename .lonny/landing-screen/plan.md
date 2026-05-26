## Plan

Add an OpenCode-style landing screen: when the app starts with no messages, show a centered input with a large single-character logo ("L") above it. After the first message, transition to the normal chat layout (input at bottom, chat content scrollable, footer bar visible).

### Approach

**Phase 1 — New `LandingScreen` component** (`src/tui/index.ts`)

Create a new `LandingScreen` component class (implementing `Component`) that renders:
1. A large "L" character logo using Unicode block characters (6 lines), centered horizontally with padding:
   ```
   ██████╗
   ██╔════╝
   ██║
   ██║
   ██║
   ╚═╝
   ```
   The "L" is colored with the accent color (`colors.accent`).
2. A subtitle line: `colors.dim("what would you like to build?")` — centered below the logo.
3. A blank line for spacing.
4. The `Input` component instance (same `Input` from `pi-tui`) with its hardcoded `"> "` prompt — this is acceptable.

The `LandingScreen` will also have:
- A public `getInput()` method to access the internal Input.
- `onSubmit` bridging: forward the Input's `onSubmit` event externally so `startTui` can hook into it.

**Phase 2 — Modify `startTui` for two-phase layout** (`src/tui/index.ts`)

Changes in the `startTui` function:

1. **Initial state (landing phase):**
   - Do NOT add `chatBox`, `input`, `loader`, or `footer` to the main TUI children yet.
   - The main TUI only has `new Spacer(1)` (for header overlay offset).
   - Create a `LandingScreen` container using a `Box(1, 1, colors.bgDark)` wrapper, and show it as a centered overlay via `tui.showOverlay(landingBox, { anchor: 'center', width: 50, maxHeight: 16 })`.
   - The `HeaderBar` overlay (top-left) stays visible but shows a minimal state (no plan/token info, just "lonny" + "idle").
   - Focus the landing screen's Input immediately.

2. **Transition (first message):**
   - Landing Input's `onSubmit` fires with the user's text.
   - Hide the landing overlay (`overlayHandle.hide()`).
   - Remove the landing overlay's Input from the tree (we simply discard it).
   - Create a **new** `Input` instance for the bottom of the chat layout.
   - Add `chatBox`, the new `input`, `loader`, and `footer` to the main TUI children (in that order).
   - Call `tui.setFocus(newInput)`.
   - Process the submitted text through the normal `sendMessage()` flow.

3. **Subsequent messages (chat phase):**
   - Everything works exactly as today.

**Phase 3 — Welcome message update** (`src/tui/index.ts`)

- The initial `chatContent` (welcome text) is no longer shown as part of the landing screen. Instead, after the first message is submitted and the transition occurs, show a shorter welcome or just start with the user's message and the response.
- Remove the current welcome message lines (lines 572-574) since the landing screen replaces them.

### Risks & Edge Cases

- **Focus management:** The Input inside the overlay must receive keyboard focus. The overlay is capturing by default (no `nonCapturing: true`), so focus should work. We call `tui.setFocus(landingInput)` after showing the overlay.
- **Two Input instances:** We use a dedicated Input for the landing screen and a separate one for the chat layout. This avoids issues with component tree ownership.
- **Terminal resize:** The centered overlay auto-repositions on resize via pi-tui's overlay system.
- **Direct prompt via `--prompt` flag:** If the user provides a prompt argument on the CLI (see `src/cli/index.ts`), the landing screen should be skipped entirely and the app should go straight to chat mode. We can detect this: if `prompt` argument was passed, skip the landing phase.
- **History navigation:** The landing Input's history is separate from the chat Input's history (since they're different instances). This is acceptable — the landing input only ever sends one message.

### Files Affected

- `src/tui/index.ts` — main file with all TUI components and logic
- `src/cli/index.ts` — possibly minor change (see risk about `--prompt` flag)

## Todo List

- [x] **src/tui/index.ts**: Create `LandingScreen` component class with the large "L" Unicode logo, subtitle text, and embedded `Input`. Expose `onSubmit` callback and `getInput()` method.
- [x] **src/tui/index.ts**: In `startTui`, modify the initial setup to create a `LandingScreen`, show it as a centered overlay, and keep the main TUI minimal (only `Spacer` for header offset).
- [x] **src/tui/index.ts**: Add transition logic in the landing Input's `onSubmit`: hide overlay, use pre-created chat Input (not a new one), add chatBox/input/loader/footer to main TUI, and process the message.
- [x] **src/tui/index.ts**: Remove the old welcome message — the landing screen replaces it.
- [x] **src/tui/index.ts**: `--prompt` CLI arg is already handled at `src/index.ts` level — when `prompt` is provided, `runAgent()` is called instead of `startTui()`, so no change needed.
- [ ] **Test manually**: Run `npm run dev` and verify:
  - Landing screen shows the "L" logo centered with the input.
  - Typing and submitting transitions to the chat layout correctly.
  - Subsequent messages work normally.
  - `--prompt "hello"` CLI arg skips the landing screen.
  - Terminal resize doesn't break the layout.
