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
├── tools/          # Tool implementations (read, edit, bash, glob, grep, etc.)
│   ├── tree.ts     # Hierarchical tool tree builder (category → group → tool)
│   └── types.ts    # ToolDefinition, ToolTreeNode interfaces with category/group
├── tui/            # Terminal UI components
├── web/            # Web UI (WebSocket server + frontend)
└── pi-tui/         # Customized terminal UI library (copied, modified)
```

## Key constraints

- **Tool mode gating**: `ask` mode has only fetch/search; `plan` mode has read-only tools + write_plan; `code` mode has full edit capabilities
- **File read tracking**: `edit` tool requires files to be read first (enforced by `FileReadTracker`)
- **Biome config**: 2-space indent, 100 line width, single quotes, as-needed semicolons; several lint rules are explicitly disabled

## Tool tree hierarchy

Each tool definition has optional `category` (top-level) and `group` (second-level) metadata.
`prompt-builder.ts` uses `formatToolTreeForPrompt()` from `tools/tree.ts` to render a hierarchically
organized tool list in the system prompt (falls back to hardcoded lists if definitions not provided).

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