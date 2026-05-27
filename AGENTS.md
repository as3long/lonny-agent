# lonny-agent

A per-call pricing optimized AI coding agent with two-phase batch editing.

## Project structure

- `src/` — TypeScript source code
  - `src/agent/` — Session management, LLM providers, system prompt, compaction, skills
  - `src/tools/` — Tool implementations (read, edit, bash, exec, glob, grep, etc.)
  - `src/config/` — Configuration loading and token usage tracking
  - `src/diff/` — File diffing and patch application
  - `src/tui/` — Terminal UI components
  - `src/cli/` — CLI argument parsing
- `.lonny/` — Project-level configuration
  - `.lonny/skills/` — Custom skill prompts (`.md` files)
  - `.lonny/prompts/` — Custom prompt templates (`.md` files)
  - `.lonny/plans/` — Generated plan documents
- `dist/` — Compiled JavaScript output

## Commands

- `npm run dev` — Run in development mode via `tsx`
- `npm run build` — Compile TypeScript via `tsc`
- `npm test` — Run tests via `vitest run`
- `npm run test:watch` — Run tests in watch mode

## Coding conventions

- **TypeScript**: Use `type: "module"` (ESM). Use `import`/`export` syntax throughout.
- **Imports**: Use `.js` extensions for relative imports (e.g. `import { Foo } from './bar.js'`).
- **Testing**: Tests live in `__tests__/` directories next to their source files. Use `vitest`.
- **Line count**: Target modules under 500 LoC. If a file exceeds ~800 LoC, extract new functionality into a new module.
- **Error handling**: Use `ToolResult` for tool return values. Use `ToolError` for structured tool errors.

## Tool development

- Each tool is a file in `src/tools/` exporting a `tool` object matching `ToolDefinition` from `src/tools/types.ts`.
- Tools are registered in `src/tools/registry.ts`.
- The `exec` tool (`src/tools/exec.ts`) exposes all other tools as `await tools.xxx(args)` inside a JavaScript sandbox.

## Editing rules

1. **Read first**: Always read files before editing. The `read` tool prefixes each line with `<lineNumber>: ` for easy reference.
2. **Use `edit` for changes**: Prefer the `edit` tool over `bash` for structured file changes.
3. **Batch edits**: Use `edits: [...]` for multiple edits in the same file — the tool processes them in reverse order so line positions stay valid.
4. **After editing, re-read**: If another edit is needed in the same file, re-read it first to get updated content.
5. **If `old_string not found`**: Do NOT retry with the same string — re-read the file and retry with correctly-copied text.
6. **CRLF on Windows**: Files may use `\r\n` line endings, but the `edit` tool normalizes to `\n`. Always use `\n` in old_string/new_string.

## Testing

- Run `npm test` to execute the full test suite.
- Use `npm run test:watch` for iterative development.
- Prefer deep equality comparisons (`toEqual`/`toStrictEqual`) over field-by-field assertions.

## Session persistence

- Sessions are saved to `~/.lonny/sessions/` as JSON files.
- Session files are keyed by a hash of the working directory.
- Token usage stats are tracked per-turn and saved via `saveTokenUsage()`.
