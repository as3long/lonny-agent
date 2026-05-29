# Plan: Adjust TUI Autocomplete to Render Above the Editor (Matching Web Style)

## Problem

The TUI's slash command autocomplete list currently renders **below** the editor input area (after the bottom border). The web version displays command hints **above** the input (`bottom: 100%` via CSS). The user wants the TUI behavior to match the web — "向上的" (upward/above).

## Root Cause

The `Editor` component from `@earendil-works/pi-tui` (`node_modules/@earendil-works/pi-tui/dist/components/editor.js`) appends the autocomplete `SelectList` lines **after** the editor's bottom border in its `render()` method (lines 418-426). To get the "above" behavior, these lines need to appear **before** the editor's top border instead.

## Approach (Final: patch-package + direct node_modules edit)

Instead of monkey-patching at runtime (which had clipping issues with `maxHeight`), we:

1. **Directly edit** `node_modules/@earendil-works/pi-tui/dist/components/editor.js` to use `result.unshift(...acLines)` instead of `result.push(...)` — placing autocomplete BEFORE the top border
2. **Increase `maxHeight`** from 6 to 12 in `src/tui/index.ts` to accommodate both autocomplete and editor content
3. **Use `patch-package`** to persist the node_modules change across `npm install`

This approach:
- Renders autocomplete ABOVE the editor (matching web UI)
- Eliminates the clipping bug (autocomplete no longer competes with editor content for the 6-line overlay)
- Survives `npm install` via patch-package

## Files Changed

### 1. `node_modules/@earendil-works/pi-tui/dist/components/editor.js` (patched)

Changed `result.push(...acLines)` to `result.unshift(...acLines)` so autocomplete renders BEFORE the top border.

### 2. `src/tui/index.ts`

- Increased `maxHeight` from 6 to 12 on both editor overlay instances
- Removed `applyEditorPatch()` import and call (old monkey-patch approach)
- Deleted `src/tui/editor-patch.ts`

### 3. `package.json`

- Added `"postinstall": "patch-package"` script
- Added `patch-package` devDependency

### 4. `patches/@earendil-works+pi-tui+0.75.5.patch` (new)

Created by `patch-package` to persist both changes:
- `editor.js`: autocomplete unshifted to before top border
- `tui.js`: alternate screen buffer handling

## Edge Cases Considered

1. **No autocomplete active** → `unshift` on empty array is a no-op; render output is unchanged
2. **Scrolled editor** → autocomplete still renders above the top border/indicator line
3. **Multiple autocomplete lines** → all moved above correctly
4. **Resize** → render is called again with new width, positioning stays correct
5. **npm install** → patch-package automatically reapplies the node_modules change

## Todo List

- [x] Step 1: Edit `node_modules/@earendil-works/pi-tui/dist/components/editor.js` to use `unshift` instead of `push` for autocomplete lines
- [x] Step 2: Increase `maxHeight` from 6 to 12 in `src/tui/index.ts`
- [x] Step 3: Remove old monkey-patch (`editor-patch.ts`, `applyEditorPatch()` import/call)
- [x] Step 4: Install `patch-package` and create patch file
- [x] Step 5: Add `postinstall` script to `package.json`
- [x] Step 6: Build and verify (`npm run build` succeeds)
