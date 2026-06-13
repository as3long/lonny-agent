# lonny-agent

AI coding agent optimized for per-call pricing. Supports three modes (`code`/`plan`/`ask`), multiple LLM providers, and TUI built with pi-tui.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Dev mode (tsx watch)
npm run build      # Build (tsc + copy web/native assets)
npm start          # Run built version
npm test           # Run tests (vitest)
npm test:watch     # Watch mode tests

# Lint & Format (Biome)
npm run lint       # Check only
npm run lint:fix   # Auto-fix
npm run format     # Format all
npm run check      # Lint + format check
npm run check:fix  # Lint + format auto-fix
```

## Architecture

```
src/
├── agent/          # Session loop, LLM providers, event bus
├── cli/            # CLI argument parsing (commander)
├── config/         # Configuration loading (env, file, defaults)
├── diff/           # File read tracking (prevents editing unread/external-modified files)
├── tools/          # Tool implementations, organized by category
│   ├── codebase/   # read, glob, grep, find, ls
│   ├── edit/       # edit, write_plan
│   ├── execute/    # bash, git
│   ├── web/        # fetch, search
│   ├── memory/     # save_memory, list_memory, delete_memory
│   ├── install/    # install_skill
│   ├── tree.ts     # Hierarchical tool tree builder
│   ├── types.ts    # ToolDefinition, ToolTreeNode interfaces
│   ├── errors.ts   # Error formatting utilities
│   └── registry.ts # ToolRegistry with registration & dispatch
├── tui/            # Terminal UI components
├── web/            # Web UI (WebSocket server + frontend)
└── pi-tui/         # Customized terminal UI library (copied, modified)
```

## Key constraints

- **Tool mode gating**: `ask` mode has only fetch/search; `plan` mode has read-only tools + write_plan; `code` mode has full edit capabilities
- **Tiered access**: core tools (read/edit/bash/glob/grep) passed directly to LLM API; extended tools accessible via `tool()` gateway proxy in `registry.ts`
- **File read tracking**: `edit` tool requires files to be read first (enforced by `FileReadTracker`)
- **Biome config**: 2-space indent, 100 line width, single quotes, as-needed semicolons; several lint rules are explicitly disabled

## Tool tree hierarchy

Each tool definition has optional `category` (top-level) and `group` (second-level) metadata.
`prompt-builder.ts` uses `formatToolTreeForPrompt()` from `tools/tree.ts` to render a hierarchically
organized tool list in the system prompt (falls back to hardcoded lists if definitions not provided).

### Tiered access (core vs gateway)

To reduce the LLM's tool selection burden, tools are split into two tiers:

- **Core tools** (direct access via API `tools` param): `read`, `edit`, `bash`, `glob`, `grep`
- **Extended tools** (invoked via `tool()` gateway): everything else

The LLM API only receives 6 tool definitions (5 core + `tool` gateway). The system prompt's
tool tree documents the full catalog, marking extended tools with `(via tool gateway)`.
When the model needs an extended tool, it calls `tool({ name: "...", params: {...} })`,
which proxies the call through `ToolRegistry.dispatch()`.

Current classification:

```
Codebase
├── Read              → read
├── Search
│   ├── By Pattern    → glob, find
│   └── By Content    → grep
└── List              → ls
Edit
├── File              → edit
└── Plan              → write_plan
Execute
├── Shell             → bash
└── Git               → git
Web
├── Fetch             → fetch
└── Search Engine     → search
Memory
├── Save              → save_memory
├── Query             → list_memory
└── Delete            → delete_memory
Install
└── Skill             → install_skill
```

## Git hooks

- `pre-commit`: lint-staged (auto-fix staged .ts/.js/.mjs with Biome)
- `commit-msg`: Conventional Commits required (`feat:`, `fix:`, `docs:`, `chore:`, etc.)

## Testing

- Unit tests in `src/**/__tests__/*.test.ts`
- Run: `npm test` (vitest)