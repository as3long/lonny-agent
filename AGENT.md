# CLAUDE.md — lonny-agent

This file provides guidance to AI coding agents working with this repository.

## Project Overview

**lonny-agent** is a per-call-pricing-optimized AI coding assistant that runs in the terminal. It supports three modes (`code`, `plan`, `ask`), multiple LLM providers (Anthropic, OpenAI, Google, Ollama), and features a TUI built with `@earendil-works/pi-tui`.

### Key Architecture

```
src/
├── agent/          # Core agent loop, session management, LLM providers
│   ├── session.ts  # Main session loop (message handling, tool dispatch)
│   ├── llm.ts      # LLM provider interface
│   ├── event-bus.ts # Decoupled event system for TUI ↔ agent communication
│   ├── compaction.ts # Context compaction (message history summarization)
│   ├── prompt-builder.ts # System prompt construction
│   └── providers/  # Anthropic, OpenAI, Google, Ollama
├── cli/            # CLI argument parsing (commander)
├── config/         # Configuration loading (env, file, defaults)
├── diff/           # File read tracking and edit validation
├── tools/          # Tool implementations (read, edit, bash, glob, grep, etc.)
│   ├── registry.ts # ToolRegistry with plugin support
│   ├── exec.ts     # JavaScript sandbox executor (inspired by Codex CLI)
│   └── types.ts    # Tool interface definitions
├── tui/            # Terminal UI (landing page, chat display, status bar)
└── index.ts        # Entry point
```

### Core Design Decisions

1. **Per-call cost optimization**: System prompt tells the model to batch operations into as few API calls as possible
2. **Three modes**: `code` (direct editing), `plan` (analysis + plan document), `ask` (Q&A only)
3. **Event bus decoupling**: TUI and agent communicate through an event bus, not direct method calls
4. **Exec sandbox**: JavaScript VM sandbox lets the model orchestrate multi-step operations in one API call
5. **File read tracking**: Prevents editing files that haven't been read or were modified externally
6. **Context compaction**: Summarizes older conversation turns when token budget is exceeded

## Git Commit Convention

Use **Conventional Commits**:

```
<type>: <description>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`

Examples:
- `feat: add Tavily web search tool`
- `fix: handle CRLF line endings in edit tool`
- `chore: add Biome + husky code quality pipeline`

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Dev mode (tsx watch)
npm run build      # Build (tsc)
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

## Code Quality

- **Formatter**: Biome (2-space indent, 100 line width, single quotes, as-needed semicolons)
- **Pre-commit**: husky + lint-staged (auto-fix staged files with Biome)
- **TypeScript**: strict mode, no unchecked index access
- **Testing**: vitest with `.test.ts` files co-located in `__tests__/` directories

## Architecture Notes

### Tool System
- `ToolRegistry` (registry.ts) manages tool registration and dispatch
- Tools implement `Tool` interface (definition + execute method)
- Plugin system allows external tool registration via `registerPlugin()`
- `exec` tool exposes all registered tools as `await tools.xxx(args)` in a sandboxed VM

### Session Flow
1. User sends message → `Session.chat()`
2. System prompt + message history + tool definitions → LLM provider
3. LLM streams response (text + tool calls)
4. Tool calls dispatched via `ToolRegistry.dispatch()`
5. Results appended to message history
6. Compaction triggered if token budget exceeded

### Testing
- Unit tests: `src/**/__tests__/*.test.ts`
- Mock strategy: mock only modules with side effects (network, filesystem)
- Avoid mocking pure functions or data modules
