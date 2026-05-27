# Learnings from OpenAI Codex CLI

After analyzing the [openai/codex](https://github.com/openai/codex) repository, here are the two highest-priority learnings we can apply to lonny-agent.

## Learning 1: `exec` tool with JavaScript sandbox (Priority 🔴)

**What Codex does:** Codex's `code-mode` provides a single `exec` tool that runs JavaScript in a V8 isolate. All other tools are exposed as nested JavaScript functions on a `tools` global object (e.g., `await tools.read({paths: ['file.ts']})`). This lets the model orchestrate multi-step operations in a single API call.

**Why it matters:**
- Reduces API round-trips (one `exec` call can do what previously required 5+ separate tool calls)
- Gives the model control flow (conditionals, loops, error handling via try/catch)
- Enables complex multi-step reasoning without returning control to the LLM between each step
- Dramatically reduces token usage from repeated tool descriptions

**What we'll implement:**
- `src/tools/exec.ts` — Uses Node.js built-in `vm` module to create a sandboxed JS execution environment
- All registered tools are exposed as `tools.xxx()` async functions
- Helper functions: `text()`, `store()`, `load()`, `exit()`, `console.log()`
- Supports `// @exec: {"timeout_ms": 30000}` pragma on first line for configuration
- Updates to system prompt to teach the model about `exec`

## Learning 2: TypeScript type declarations in tool descriptions (Priority 🟡)

**What Codex does:** Codex's `build_exec_tool_description()` generates TypeScript type declarations for every nested tool.

**Why it matters:**
- Makes tool interfaces crystal clear to the model
- Reduces errors from incorrect parameter types
- Works naturally with the `exec` tool's JavaScript sandbox

**What we'll implement:**
- Generate TypeScript declarations for each tool's parameters
- Include declarations in the `exec` tool description
- Update system prompt to reference the typed interface

---

## Todo List

- [x] **Learning 1**: Create `src/tools/exec.ts` with vm sandbox
- [x] **Learning 1**: Update `src/tools/registry.ts` to register exec tool
- [x] **Learning 1**: Update system prompt in `src/agent/session.ts` to mention exec
- [x] **Learning 2**: Add TypeScript type declaration generation for tools
- [x] **Learning 2**: Include type declarations in exec tool description
- [x] **Learning 2**: Add AGENTS.md with project instructions for AI agents
