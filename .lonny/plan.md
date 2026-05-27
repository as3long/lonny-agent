# Plan: 在 TUI 右侧持久显示 TODO List

## 分析

TUI (`src/tui/index.ts`) 目前已有：
- `loadTodos(filePath)` — 从 plan.md 文件中解析 `## Todo List` 下的 checkbox 列表
- Plans overlay — 右侧浮层，选中 plan 后按 Enter 可查看 TODO
- `planCb` 回调 — plan 写入后刷新计划列表

用户期望在 TUI 右侧**持续显示**当前最新 plan 的 TODO 列表（而非仅通过 `/plans` 命令临时打开）。

## 实现方案

1. 新增 `TodoPanel` 组件类，实现 `Component` 接口
   - 自动读取 `.lonny/` 中最新的 plan 文件（`listPlans` 已按 mtime 降序）
   - 解析 `## Todo List` 章节的 checkbox 条目
   - 渲染为紧凑的右侧面板，带有 header 和条目列表
   - 提供 `refresh()` 方法以在 plan 变更时重新加载

2. 在聊天模式建立后，将 `TodoPanel` 作为持久 overlay 添加到右侧
   - `anchor: 'right-center'`, `nonCapturing: true`
   - 宽度约 32 列，让出主要空间给聊天区域
   - 自动隐藏的可见性条件：终端宽度不足时隐藏

3. 与现有回调集成
   - `planCb` 中调用 `todoPanel.refresh()` 以在 plan 写入时更新
   - 聊天输入后的 `refreshPlans()` 中也触发刷新

## 需要修改的文件

只修改 `src/tui/index.ts`

### 具体修改点

1. **新增 `TodoPanel` 类**（`startTui` 函数之前，约第 668 行）：
   - 构造函数接收 `cwd`
   - 实现 `invalidate()`, `render(width)` 
   - 核心逻辑：读取最新 plan，解析 todo items，渲染为彩色文本

2. **创建 TodoPanel 实例**（`startTui` 函数内，约第 841 行附近，`plansList` 创建之后）：
   - `const todoPanel = new TodoPanel(config.cwd)`
   - 添加 `showTodoPanel()` 工具函数，使用 `tui.showOverlay` 以 overlay 形式显示

3. **在聊天模式建立时显示 TodoPanel**：
   - landing screen 过渡时（约第 1154 行）调用 `showTodoPanel()`
   - session 恢复时（约第 834 行）调用 `showTodoPanel()`

4. **集成刷新回调**：
   - `planCb`（约第 766 行）中添加 `todoPanel.refresh()`
   - `refreshPlans()`（约第 972 行）中添加 `todoPanel.refresh()`
