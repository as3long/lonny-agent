# Codebase Issues & Implementation Plan

## Issue Overview

After thoroughly auditing this TypeScript codebase, I found **12 issues** across 8 files. Below is a prioritized breakdown.

---

## Plan

### 🔴 Priority 1 — Potential User-Facing Bugs

**1. TUI: Alt screen exit order bug — `src/tui/index.ts:648-651`**
The `tui.stop()` override writes `\x1b[?1049l` (exit alternate screen buffer) **BEFORE** calling `origStop()`. The original `stop()` does cursor positioning + raw mode cleanup. After exiting alt screen, these operations happen in the main screen buffer instead of the alt buffer, which can leave the terminal in a broken state. Fix: swap the order (call `origStop()` first, then exit alt screen).

**2. Ask mode system prompt contradiction — `src/tui/session.ts:228-238, 265-275`**
In ask mode, the mode-specific instructions say "You can ONLY use `fetch` and `search`" and "You CANNOT use `read`/`edit`/`bash`/`glob`/`grep`/`ls`/`find`/`git`". But the `sharedRules` section (appended right after) lists ALL 10 tools including `read`, `edit`, `bash`, etc. This contradicts the ask-mode restriction and could confuse the model into using tools it shouldn't. Fix: filter the `sharedRules` tool list based on mode, or omit it in ask mode.

### 🟡 Priority 2 — Code Quality / Maintainability

**3. `visibleLen()` duplicated 3x — `src/tui/components.ts:271, 405, 580`**
Three classes (`RichFooter`, `LandingScreen`, `TodoPanel`) each define an identical `visibleLen()` method. Extract to a shared utility function.

**4. Tavily API key loaded from disk on every tool call — `src/tools/search.ts:10-18`**
Each `search` call reads `~/.lonny/config.json` from disk, even though the API key rarely changes. Should cache in a module-level variable.

**5. Event bus memory leak — `src/agent/event-bus.ts:89-94`**
`getGlobalEventBus()` creates a singleton that's never cleaned up. `resetGlobalEventBus()` exists but is never called. When `/new` creates a fresh session, old event listeners accumulate.

**6. Compaction token estimator is too simplistic — `src/agent/compaction.ts:12-13`**
Uses `ceil(length / 4)` which is very inaccurate for CJK text (Chinese characters can be 2-3 tokens each) and JSON/tool_call content. For a 128K token budget, this could cause over-compaction (too aggressive) or under-compaction (too late). Consider using a more accurate estimator.

**7. Session restore loses cached system prompt — `src/agent/session.ts:386-388`**
On restore, `messages[0]` is replaced with a fresh system prompt built from current config. This is mostly correct, but the saved system prompt (which cost tokens to generate) is discarded. Minor optimization opportunity: skip rebuild if config is identical.

### 🔵 Priority 3 — Minor / Polish

**8. API key in Google URL query param — `src/agent/providers/google.ts:123`**
API key is passed as `?key=${apiKey}` in the URL. This could leak in server access logs. Use `x-goog-api-key` header instead.

**9. `as any` type cast in OpenAI provider — `src/agent/providers/openai.ts:84`**
The `create()` call uses `as any` to bypass TypeScript for non-standard OpenAI parameters. Could use proper type extension.

**10. Session file isn't cleaned on mode/model change — `src/agent/session.ts:406-410`**
`setMode()` and `setModel()` update the in-memory system prompt but the persisted session file retains the old system prompt (with old rules). On restore, the system prompt is rebuilt, so this is cosmetic — but the saved messages array is temporarily inconsistent until the next `save()` call.

**11. Shell prompt uses Unix examples for Windows — `src/agent/session.ts:297`**
Windows warning says "don't use `cat`, `ls`, `grep`" — these don't exist on Windows. Simpler: just say "Use PowerShell" without naming Unix commands.

**12. Missing unit tests for TUI components — `src/tui/*.ts`**
No tests for `components.ts`, `index.ts`, `balance.ts`, or `highlight.ts`. `diff/apply.ts` also has no tests. These files contain non-trivial logic.

---

## Todo List

- [x] **Fix 1**: Alt screen exit order — already fixed by the remove-header-alt-screen plan (alt screen code was removed entirely).
- [x] **Fix 2**: In `src/agent/session.ts`, filter the `sharedRules` tool list based on `config.mode` — for ask mode, only list `fetch` and `search`.
- [x] **Fix 3**: Extract `visibleLen()` to a shared utility (`src/tui/utils.ts`) and import it in `RichFooter`, `LandingScreen`, and `TodoPanel`.
- [x] **Fix 4**: Cache the Tavily API key in a module-level variable in `src/tools/search.ts`.
- [x] **Fix 5**: Call `resetGlobalEventBus()` when `/new` clears a session in `src/tui/index.ts`.
- [x] **Fix 6**: Improve token estimation in `src/agent/compaction.ts` — added detailed CJK limitation comment.
- [x] **Fix 7**: In `src/agent/session.ts:386-388`, only rebuild the system prompt if config actually changed (model, mode, etc.).
- [x] **Fix 8**: In `src/agent/providers/google.ts`, move the API key from URL query to `x-goog-api-key` header.
- [x] **Fix 9**: In `src/agent/providers/openai.ts`, create a proper typed interface for the create params instead of `as any`.
- [x] **Fix 10**: Call `save()` after `setMode()` to persist the updated system prompt immediately.
- [x] **Fix 11**: In `src/agent/session.ts`, simplify Windows shell instructions — say "Use PowerShell" instead of listing Unix commands.
- [x] **Fix 12**: Add unit tests for `src/tui/components.ts`, `src/tui/balance.ts`, and `src/diff/apply.ts`.
