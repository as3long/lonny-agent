# Tavily Search Tool

## Plan

1. **Create `src/tools/search.ts`** — a new Tavily search tool that:
   - Reads the `tavilyApiKey` from `~/.lonny/config.json` (the same config file already used by the project)
   - Calls the Tavily API (`POST https://api.tavily.com/search`) with parameters: `query`, `search_depth` (basic/advanced), `include_answer`, `max_results`
   - Returns formatted search results including the answer and result items
   - Follows the same `Tool` interface pattern as existing tools (e.g. `fetch.ts`)

2. **Update `src/tools/registry.ts`** — import and register `searchTool` in `registerBuiltins()`

3. **Update `src/agent/session.ts`** — add `search` to the system prompt's "Available tools" list and add search-specific display formatting in `printToolResult()` / `formatToolInput()`

## Todo List

- [x] Create `src/tools/search.ts` with Tavily search tool
- [x] Register search tool in `src/tools/registry.ts`
- [x] Update system prompt and result formatting in `src/agent/session.ts`
