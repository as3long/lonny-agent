## Plan

### 3.2 消除模块级可变状态 — `src/tools/write_plan.ts`

**问题**: `let onPlanWritten` 是模块级变量，通过 `setOnPlanWritten()` 设置。这是可变全局状态。

**方案**: 将 `onPlanWritten` 回调作为 `createWritePlanTool()` 的参数传入，移除模块级变量和 `setOnPlanWritten()` 导出。

涉及修改：
- `src/tools/write_plan.ts`: 删除 `let onPlanWritten`、`setOnPlanWritten()`、`notifyPlanWritten()`，改为 `createWritePlanTool(cwd, onPlanWritten?)` 
- `src/tui/index.ts`: 将 `setOnPlanWritten(...)` 改为在创建工具时传入回调
- `src/tools/registry.ts`: 检查 `createWritePlanTool` 的调用方式

### 3.3 nodeGrep 支持 .gitignore

**位置**: `src/tools/grep.ts`

**方案**: 添加 `.gitignore` 解析逻辑，跳过被忽略的文件/目录。

### 3.4 已修复

`src/index.ts:43` 已有 `err instanceof Error` 检查。

### 3.1 提取 Provider 共享逻辑（可选，改动较大）

创建 `src/agent/providers/shared.ts`，提取：
- 工具定义格式化（`openai.ts:24-44` 和 `anthropic.ts:18-35` 的公共部分）
- 消息转换逻辑

## Todo List

- [ ] **3.2** `src/tools/write_plan.ts`: 移除模块级 `onPlanWritten`，改为 `createWritePlanTool(cwd, onPlanWritten?)` 参数注入
- [ ] **3.2** `src/tui/index.ts`: 更新 `setOnPlanWritten` 调用方式，改为传入 `createWritePlanTool` 的回调参数
- [ ] **3.2** `src/tools/registry.ts`: 检查并更新 `createWritePlanTool` 调用
- [ ] **3.3** `src/tools/grep.ts`: 添加 `.gitignore` 支持（解析规则 → 过滤文件）
- [ ] **3.1** `src/agent/providers/shared.ts`: 创建共享函数文件
- [ ] **3.1** `src/agent/providers/openai.ts`: 使用共享函数
- [ ] **3.1** `src/agent/providers/anthropic.ts`: 使用共享函数
- [ ] 编译验证：`npx tsc --noEmit`
- [ ] 测试验证：`npm test`
