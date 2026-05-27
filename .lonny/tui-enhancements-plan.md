# TUI Enhancements Plan

## Summary

Based on thorough analysis of pi's `@earendil-works/pi-tui` component library and the full pi coding-agent TUI (`interactive-mode.ts`, theme system, keybindings, autocomplete, settings), I've identified the highest-impact enhancements for lonny-agent's TUI. The approach is additive — we use pi-tui's existing components (already in `package.json`) rather than reimplementing them from scratch.

---

## 1. Replace single-line Input with multi-line EditorComponent + Autocomplete

**Why:** The current `LandingInput` is a custom single-line input that lacks history, multi-line support, word navigation, and autocomplete. pi's `CustomEditor` (from `@earendil-works/pi-tui`) provides all of this plus a `CombinedAutocompleteProvider`.

**What to do:**
- `src/tui/index.ts:701` — Replace `new Input()` with `new CustomEditor(ui, editorTheme, keybindings)`
- `src/tui/index.ts:674-680` — Create an `EditorTheme` object for the editor's border
- `src/tui/index.ts:526-536` — Wire up `CombinedAutocompleteProvider` for file path and slash command completion
- Remove the custom `LandingInput` class (lines 296-500) since it's no longer needed
- Remove the `LandingScreen` wrapper or simplify it to use the standard editor

**Impact:** Multi-line editing, history (↑/↓), word navigation (Ctrl+←/→), Tab autocomplete for files and commands, paste support.

---

## 2. Add a proper rich footer bar (mimicking pi's FooterComponent)

**Why:** The current `FooterBar` and `StatusBar` are static. pi's footer shows: cwd, git branch, session name, token usage (↑input ↓output), cache reads/writes, cost, context %, model name, thinking level, extension statuses.

**What to do:**
- `src/tui/index.ts:237-257` — Replace `FooterBar` with a `FooterComponent`-like class that:
  - Reads `Session` for token counts, cost, model info
  - Shows cwd (with `~` home abbreviation)
  - Shows context usage % (with color coding: >90% red, >70% yellow)
  - Shows model name
  - Is updated on each session event (message_end, model_change)
- Add a `formatTokens()` helper for compact display (1.2k, 3.4M etc.)

**Impact:** Users can see token burn rate, cost, context pressure, and model at a glance.

---

## 3. Implement a proper SelectList-based plans overlay with keyboard navigation

**Why:** The current plans overlay uses a custom `PlansList` wrapper. pi's `SelectList` supports fuzzy filtering built-in — we should use it properly.

**What to do:**
- `src/tui/index.ts:791-824` — Enhance `showPlansOverlay()` to use `SelectList`'s built-in filtering
- Add keyboard navigation: ↑/↓ to navigate, Enter to view selected plan, / to filter, Esc to close
- Add a "plan detail" view when Enter is pressed: show the plan's todo items inline

**Impact:** Much smoother plan browsing experience.

---

## 4. Add basic slash command autocomplete

**Why:** pi shows available slash commands in autocomplete. Currently lonny has hardcoded command matching in `sendMessage()`.

**What to do:**
- `src/tui/index.ts:892-1004` — Register slash commands with the autocomplete provider:
  - `/mode`, `/model`, `/plans`, `/prompts`, `/skills`, `/new`, `/init`, `/help`, `/exit`
- When user types `/` in the editor, show matching command autocomplete

**Impact:** Users discover commands naturally.

---

## 5. Add inline tool execution display with expand/collapse

**Why:** pi renders tool calls as rich expandable components. Currently lonny just streams tool output into the chat text.

**What to do:**
- Create a `ToolExecutionBox` component that wraps tool output:
  - Header shows tool name + status (running/success/error)
  - Content is expandable/collapsible (default collapsed for long output)
  - Uses `Box` for background coloring (yellow for pending, green for success, red for error)
- Wire into `session.chat()` so tool events update the component in real-time

**Impact:** Cleaner separation of tool outputs from assistant text, especially for long bash/read outputs.

---

## 6. Improve Markdown rendering with a theme object

**Why:** The current `markdownTheme` is hardcoded. pi separates theme into a `MarkdownTheme` interface that can be swapped.

**What to do:**
- `src/tui/index.ts:656-671` — Extract markdown theme into a proper `MarkdownTheme` object
- Add syntax highlighting support for code blocks (using `cli-highlight` or similar)
- Ensure code block indentation is configurable

**Impact:** Better looking code blocks, easier to theme later.

---

## Implementation Order

1. **Step 1** — Multi-line editor + autocomplete (highest user impact)
2. **Step 2** — Rich footer bar (token awareness)
3. **Step 3** — Tool execution display
4. **Step 4** — SelectList plans overlay improvements
5. **Step 5** — Slash command autocomplete
6. **Step 6** — Markdown theme cleanup

---

## Todo List

- [x] Step 1 — Replace `Input` with `Editor` from `@earendil-works/pi-tui`, wire up `CombinedAutocompleteProvider` for file/command completion, remove `LandingInput` class
- [x] Step 5 — Register slash commands with the autocomplete provider so `/` triggers command completion (done as part of Step 1 — `SlashCommand[]` is passed directly to `CombinedAutocompleteProvider`)
- [x] Step 2 — Build a `RichFooter` component showing cwd, mode, token usage (formatTokens), model/provider, version, and command hints. Replaces both `FooterBar` and `StatusBar`.
- [x] Step 4 — Enhance `showPlansOverlay()` with Enter-to-view-detail (shows todo items), Esc to go back, proper keyboard navigation
- [x] Step 3 — Create a `ToolExecutionBox` component with expand/collapse for streaming tool outputs, wired into the chat flow
- [x] Step 6 — Clean up markdown theme into a proper `MarkdownTheme` object, add code block syntax highlighting
