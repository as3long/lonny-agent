# 项目优化计划

## Plan

基于对代码库的全面审查（30个源文件），按优先级从高到低排列以下优化项。每个优化项都基于实际代码分析。

### 优先级 1（高影响，低风险）：删除死代码 + 修复类型安全

**1.1 清理死代码：`PatchApplier.apply()` 及其关联类型**
- **位置**: `src/diff/apply.ts:55-143`（`apply()` 方法），`src/diff/types.ts`（`FileChange`, `Hunk`, `HunkLine`, `Patch` 类型）
- **现状**: `apply()` 方法以及 `types.ts` 中的 `FileChange`, `Hunk`, `HunkLine`, `Patch` 类型在整个代码库中没有任何引用（除了互相引用）。唯一被使用的是 `PatchApplier.markRead()` 和 `PatchApplier.checkModified()`（私有方法）。
- **方案**: 
  1. 移除 `src/diff/types.ts` 中的死类型
  2. 简化 `src/diff/apply.ts`：删除 `apply()` 方法（及辅助函数 `applyHunks`, `applyHunk`, `findHunkStart`, `normalize`），只保留 `PatchApplier` 类的 `markRead()` 和 `checkModified()` 方法
  3. 重命名以反映其真实用途（如 `FileReadTracker`）
- **风险**: 低 — 这些代码根本没有被调用。测试覆盖了 PatchApplier 的 markRead 用法。

**1.2 消除 `as any` 类型断言**
- **位置**: `src/agent/providers/anthropic.ts:79,80`, `src/agent/providers/openai.ts:68,78,86`, `src/agent/session.ts:101`, `src/tui/index.ts:123`
- **方案**:
  1. `anthropic.ts`: 使用 SDK 的 `MessageParam` / `ToolUseBlockParam` 类型替代 `as any`
  2. `openai.ts`: 使用 SDK 的 `ChatCompletionMessageParam` / `ChatCompletionTool` 类型
  3. `session.ts:101`: 添加适当的类型守卫而非 `as Array<>`
  4. `tui/index.ts:123`: 使用显式属性访问而非 `(b as any).mtime`

### 优先级 2（中等影响）：性能优化 — 异步 I/O

**2.1 `bash.ts`：`execSync` → `exec`/`spawn`（异步）**
- **位置**: `src/tools/bash.ts:23`
- **方案**: 将 `execSync` 替换为 `exec` 的 Promise 包装，避免阻塞事件循环

**2.2 `read.ts`：同步 `fs.statSync`/`fs.readFileSync` → 异步**
- **位置**: `src/tools/read.ts:35,44`
- **方案**: 使用 `fs.promises.stat()` / `fs.promises.readFile()`

**2.3 `grep.ts`：`nodeGrep` 递归同步 I/O → 异步**
- **位置**: `src/tools/grep.ts:42-64`
- **方案**: 使用 `fs.promises.readdir()` / `fs.promises.readFile()`，并发读取

**2.4 `tokens.ts`：同步文件操作 → 异步**
- **位置**: `src/config/tokens.ts:29,43,78,95,99`
- **方案**: 使用 `fs.promises` API

**2.5 `config/index.ts`：`loadJsonConfig` 同步读取 → 带缓存的异步读取**
- **位置**: `src/config/index.ts:26-34`
- **方案**: 缓存解析后的配置，避免每次 `loadConfig()` 调用都读盘

### 优先级 3（中等影响）：代码质量改善

**3.1 提取 Provider 共享逻辑**
- **位置**: `src/agent/providers/anthropic.ts:18-35`, `src/agent/providers/openai.ts:22-42`
- **方案**: 创建 `src/agent/providers/shared.ts`，提取工具定义格式化和消息转换的公共函数

**3.2 消除模块级可变状态**
- **位置**: `src/tools/write_plan.ts:8-16`
- **方案**: 将 `onPlanWritten` 回调作为 `createWritePlanTool()` 的参数传入，而非模块级变量

**3.3 `nodeGrep` 支持 `.gitignore`**
- **位置**: `src/tools/grep.ts:48-49`
- **方案**: 使用 `ignore` 包或 `.gitignore` 解析逻辑过滤文件

**3.4 修复错误处理**
- **位置**: `src/index.ts:43`
- **方案**: 添加 `err instanceof Error` 检查

### 优先级 4（低影响）：架构改善

**4.1 拆分 TUI 文件**
- **位置**: `src/tui/index.ts`（1013 行）
- **方案**: 拆分为 `src/tui/components/header-bar.ts`, `footer-bar.ts`, `landing-input.ts`, `landing-screen.ts`, `plans-list.ts`, `status-bar.ts`

**4.2 参数化硬编码值**
- **位置**: `anthropic.ts:81`（`max_tokens: 8192`）, `session.ts:248`（`maxIterations = 50`）, `read.ts:40`（1MB 限制）, `bash.ts:20`（120s 超时）
- **方案**: 将硬编码值提取到 `Config` 接口或模块级常量中

### 注意事项
- 优先级 1 和 2 的更改可以独立进行，不会相互阻塞
- 优先级 3.1（Provider 共享）需要同时修改两个 provider 文件，需仔细处理
- 优先级 4.1（TUI 拆分）是所有优化中改动量最大的，建议放在最后
- 所有更改应保持向后兼容，通过 `vitest` 测试验证

## Todo List

### 第一阶段：清理死代码 + 修复类型安全
- [ ] 1.1 简化 `src/diff/apply.ts` - 删除 `apply()`, `applyHunks()`, `applyHunk()`, `findHunkStart()`, `normalize()`，只保留 `markRead()` / `checkModified()`
- [ ] 1.2 清理 `src/diff/types.ts` - 删除 `FileChange`, `Hunk`, `HunkLine`, `Patch` 类型
- [ ] 1.3 将 `PatchApplier` 重命名为如 `FileReadTracker` 以反映真实用途
- [ ] 1.4 修复 `src/agent/providers/anthropic.ts` 中的 `as any` 断言
- [ ] 1.5 修复 `src/agent/providers/openai.ts` 中的 `as any` 断言
- [ ] 1.6 修复 `src/agent/session.ts:101` 中的 `as Array<>` 类型断言
- [ ] 1.7 修复 `src/tui/index.ts:123` 中的 `(b as any).mtime`

### 第二阶段：异步 I/O 性能优化
- [ ] 2.1 将 `src/tools/bash.ts` 的 `execSync` 改为异步 `exec`
- [ ] 2.2 将 `src/tools/read.ts` 的同步 `fs.statSync`/`readFileSync` 改为异步
- [ ] 2.3 将 `src/tools/grep.ts` 的 `nodeGrep` 改为异步递归遍历
- [ ] 2.4 将 `src/config/tokens.ts` 的同步文件操作改为异步
- [ ] 2.5 为 `src/config/index.ts` 的 `loadJsonConfig` 添加缓存

### 第三阶段：代码质量提升
- [ ] 3.1 创建 `src/agent/providers/shared.ts` 提取工具格式化和消息转换共享逻辑
- [ ] 3.2 将 `src/tools/write_plan.ts` 的模块级 `onPlanWritten` 改为参数注入
- [ ] 3.3 为 `src/tools/grep.ts` 的 `nodeGrep` 添加 `.gitignore` 支持
- [ ] 3.4 修复 `src/index.ts` 中的 `err.message` 错误处理

### 第四阶段：架构优化
- [ ] 4.1 将 `src/tui/index.ts` 拆分为 `src/tui/components/` 下的独立组件文件
- [ ] 4.2 将 `src/agent/providers/anthropic.ts` 的 `max_tokens` 参数化到配置
- [ ] 4.3 将 `src/agent/session.ts` 的 `maxIterations` 参数化到配置
- [ ] 4.4 统一所有 `import` 使用 `node:` 前缀风格
