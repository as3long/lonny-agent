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

---

# CCB (Claude Code Best) 学习计划

> 基于 https://github.com/claude-code-best/claude-code 的分析，提炼可应用于 lonny-agent 的工程实践。

---

## 一、CCB 项目概览

CCB 是 Anthropic 官方 Claude Code CLI 的反向工程/反编译源码恢复项目，拥有 **19k+ stars**，代码量庞大。

**关键数据：**
- 语言：TypeScript（strict mode）
- 运行时：Bun（非 Node.js）
- 构建：Bun.build() + Vite（代码分割，600+ chunk 文件）
- 工具：60 个内置工具，独立 `packages/builtin-tools/` 包
- UI：React + Ink（终端 React 渲染框架），149 个组件
- 包管理：Bun workspaces，17 个 workspace 包
- 测试：bun:test，单元测试 + 集成测试
- CI：GitHub Actions（lint + 构建 + 测试）

---

## 二、可借鉴的关键工程实践

### P0（立即实施）

#### 1. ✅ Biome + Husky + lint-staged 代码质量流水线

**CCB 的做法：**
- 使用 [Biome](https://biomejs.dev/) 替代 ESLint + Prettier（单工具、速度快）
- `biome.json` 配置：2-space 缩进、80 行宽（tsx 120行）、单引号、按需分号
- 关闭了 42 条 lint 规则（因为反编译代码的局限性）
- **husky** 管理 git hooks，`.husky/pre-commit` 中运行 `npx lint-staged`
- **lint-staged** 只对暂存文件运行：
  - `*.{ts,tsx,js,mjs,jsx}` → `biome check --fix`
  - `*.{json,jsonc}` → `biome format --write`
- VCS 集成：`"vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true }`
  - Biome 自动忽略 git 未跟踪的文件，减少 lint 噪音
- CI 中运行 `bunx biome ci .`，lint/格式化不达标则失败

**lonny 现状：** 无格式化工具，无 pre-commit hook，无统一代码风格

**实施步骤：**
```bash
npm install --save-dev biome husky lint-staged
npx husky init  # 创建 .husky/pre-commit
```

**biome.json 配置**（适配 lonny 的项目特点）：
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**", "!!**/dist", "!!**/node_modules"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "single", "semicolons": "asNeeded", "trailingCommas": "all" } }
}
```

**package.json 脚本：**
```json
{
  "scripts": {
    "lint": "biome lint .",
    "lint:fix": "biome lint --fix .",
    "format": "biome format --write .",
    "check": "biome check .",
    "check:fix": "biome check --fix .",
    "precheck": "npm run typecheck && npm run check:fix && npm test",
    "prepare": "husky"
  }
}
```

**lint-staged 配置**（在 package.json 中）：
```json
{
  "lint-staged": {
    "*.{ts,js,mjs}": ["biome check --fix --no-errors-on-unmatched"],
    "*.{json,jsonc}": ["biome format --write --no-errors-on-unmatched"]
  }
}
```

---

#### 2. 📋 AGENT.md — AI 代理指导文件

**CCB 的做法：**
- 仓库根目录有 `CLAUDE.md`（27k+ 字符）和 `AGENTS.md`（20k+ 字符）
- 为 Claude Code（claude.ai/code）和其他 AI 编码代理提供项目上下文
- 包含：项目概览、Git 提交规范、命令参考、架构文档、测试规范、代码规范

**lonny 现状：** 已有 AGENTS.md（来自 Codex 学习），但无 AGENT.md

**实施步骤：**
创建 `AGENT.md`，包含：
- 项目概述和定位
- 目录结构说明
- 常用命令
- 架构说明
- 代码规范
- 测试要求

---

#### 3. 🧪 测试基础设施改进

**CCB 的做法：**
- 框架：`bun:test`（Bun 内置，零配置）
- 单元测试就近放置：`src/**/__tests__/`，文件名 `<module>.test.ts`
- 集成测试：`tests/integration/`
- 共享 mock/fixture：`tests/mocks/`
- Mock 规范：只 mock 有副作用的依赖链，不 mock 纯函数
- 命名规范：`describe("functionName")` + `test("behavior description")`

**lonny 现状：** 已有 vitest 但测试覆盖不足，已有少量测试文件

**改进点：**
- 统一测试文件命名和位置规范
- 补充核心模块测试（tools/registry, agent/session, diff/apply）
- 添加集成测试
- 添加 `precheck` 脚本确保测试通过

---

#### 4. 📝 Conventional Commits + 提交规范

**CCB 的做法：**
- 使用 Conventional Commits 规范
- `feat:`、`fix:`、`docs:`、`chore:`、`refactor:`
- husky 配合 commitlint 或 lint-staged 拦截不合格提交

**lonny 现状：** 无提交规范

**实施步骤：**
- 在 CLAUDE.md 中约定提交格式
- 添加 commitlint 或简单校验

---

### P1（中期实施）

#### 5. 🔧 工具系统改进

**CCB 的做法：**
- 60 个工具独立在 `packages/builtin-tools/` 包中
- 工具注册采用白名单制（`CORE_TOOLS` 常量）
- 工具延迟加载（deferred tools）：通过 TF-IDF 语义搜索按需加载
- MCP 工具支持（Model Context Protocol）

**lonny 现状：** 已有 ToolRegistry + 插件系统，但工具数量少（12个），无延迟加载

**改进方向：**
- 将工具拆分为独立包或模块
- 添加 MCP 客户端支持
- 实现工具延迟加载

---

#### 6. 🔀 Feature Flag 系统

**CCB 的做法：**
- `import { feature } from 'bun:bundle'`
- `feature('FLAG_NAME')` 返回 boolean
- 通过环境变量 `FEATURE_<FLAG_NAME>=1` 启用
- Build/Dev 各有自己的默认启用列表
- 构建时通过 `Bun.build({ define })` 注入常量，死代码消除

**lonny 现状：** 无 feature flag 系统

**实施步骤：**
- 实现轻量级 `feature()` 函数
- 通过环境变量控制功能开关
- 在代码中用 `if (feature('FLAG'))` 控制实验性功能

---

#### 7. 🏗️ 构建流水线改进

**CCB 的做法：**
- `build.ts` 自定义构建脚本
- 代码分割（code splitting）：600+ chunk 文件减少内存占用
- 构建产物兼容 Node.js + Bun 双运行时
- 构建时注入 defines 常量

**lonny 现状：** 简单 `tsc` 编译

**改进方向：**
- 添加构建后处理脚本
- 考虑代码分割（项目规模增大后）

---

### P2（长期目标）

#### 8. 🔌 MCP 协议支持
#### 9. 🤖 Sub-agent / Fork Agent 系统
#### 10. 🌐 多 Provider 扩展（Bedrock、Vertex、Grok）
#### 11. 📊 遥测和监控
#### 12. 🐳 Docker 部署支持

---

## 三、总结优先级

| 优先级 | 项目 | 工作量 | 影响 |
|--------|------|--------|------|
| P0 | Biome + Husky + lint-staged | 小 | 高 |
| P0 | AGENT.md | 小 | 高 |
| P0 | 测试改进 | 中 | 高 |
| P0 | 提交规范 | 小 | 中 |
| P1 | Feature Flag | 中 | 高 |
| P1 | 工具系统改进 | 大 | 高 |
| P1 | 构建流水线 | 中 | 中 |
| P2 | MCP/Sub-agent | 大 | 中 |

---

## 四、待办清单

- [x] 分析 CCB 项目的工程实践
- [x] **P0: 添加 Biome + Husky + lint-staged 代码质量流水线**
  - [x] 安装 @biomejs/biome、husky、lint-staged
  - [x] 创建 biome.json 配置
  - [x] 初始化 husky
  - [x] 配置 lint-staged
  - [x] 在 package.json 中添加脚本
  - [x] 运行 `biome check --fix` 格式化现有代码
- [x] **P0: 创建 AGENT.md**
- [x] **P0: 补充核心模块测试**
  - [x] event-bus.test.ts (10 tests: emit/on, unsubscribe, error handling, singleton)
  - [x] compaction.test.ts (11 tests: token estimation, compaction trigger, tool-call safety)
  - [x] skills.test.ts (9 tests: loading, frontmatter parsing, validation, formatting)
  - [x] tokens.test.ts (5 tests: save/load, accumulation, reset, list)
  - [x] 总计 114 个测试全部通过
- [x] **P0: 建立 Conventional Commits 规范**
  - [x] 创建 .husky/commit-msg hook 校验提交格式
  - [x] 在 AGENT.md 中约定提交规范
- [ ] **P1: 实现 Feature Flag 系统**
- [ ] **P1: 改进工具系统**
- [ ] **P1: 改进构建流水线**
