# Changelog

## [Unreleased]

### Added
- `ast_query` now supports `references` query type — finds all call sites of a
  function in a file (e.g., `ast_query path=file.ts query=references nameFilter=foo`).
- `ast_edit` now supports `insert-method` edit type — inserts a method into an
  existing class at the correct position with proper indentation.
  (e.g., `ast_edit path=file.ts editType=insert-method className=MyClass methodCode="newMethod() { return 42 }"`).
- Added `Reference` type to AST types (line, column, context).
- Added `findReferences` method to `AstAdapter` interface.
- Added `insertMethodIntoClass` method to `AstAdapter` interface.
- Added multi-file batch edit integration test for `ast_edit`.
- Added CI workflow (`.github/workflows/ci.yml`) with lint, test, and
  line-count check steps.
- Added `check:lines` npm script to detect source files exceeding 500 lines.
- Added `scripts/check-line-count.mjs` — scans `src/` (excluding `pi-tui`)
  for `.ts` files over 500 lines.

### Fixed
- Web UI and TUI now correctly parse todo items from plan files with
  Chinese/emoji section headers (e.g., `## ✅ 已完成`, `## 🚧 待优化`).
  Previously only English `## Todo` was recognized.