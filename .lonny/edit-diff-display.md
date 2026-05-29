## Plan

### 需求分析

用户希望在 `edit` 工具修改文件时，能直观地看到哪些内容被移除（红色）和哪些被替换/添加（绿色），并且这个效果需要在 **TUI（终端）** 和 **Web UI** 中都生效。

### 相关源文件

| 文件 | 作用 |
|------|------|
| `src/tools/edit.ts` | Edit 工具实现 — 生成工具执行结果输出 |
| `src/agent/session.ts:154-160` | `printToolResult` — 终端输出 edit 结果 |
| `src/tui/highlight.ts:184-198` | `highlightDiffLine` — 已存在 diff 高亮功能 |
| `src/web/index.ts:20-22` | `stripAnsi` — 剥离 ANSI 转义码 |
| `src/web/session-bridge.ts:50-52` | 将 tool result 转发到 WebSocket |
| `src/web/public/app.js:271-297` | `addToolResult` — Web UI 渲染工具结果 |
| `src/web/public/style.css` | Web UI 样式表 |

### 实现方案

**核心思路**：Edit 工具的输出结果中直接包含带颜色的 diff 内容。TUI 和 Web UI 各自解析展示。

1. **`src/tools/edit.ts`** — 在每个成功编辑的 `results` 数组中，增加文件路径头 + 逐行对比的 diff 内容：
   - 已移除行用 ANSI 红色（`\x1b[38;2;255;80;80m`）标记 `-` 前缀
   - 新添加行用 ANSI 绿色（`\x1b[38;2;0;200;100m`）标记 `+` 前缀
   - 保持与 `highlight.ts` 中 `highlightDiffLine` 一致的色彩方案

2. **`src/agent/session.ts`** — 修改 `printToolResult` 中的 edit 分支，直接输出 diff 内容，不需要额外缩进和着色（因为 diff 本身已经带颜色了）。

3. **`src/web/public/app.js`** — 修改 `addToolResult` 函数：当工具名为 `edit` 且输出中包含 diff 格式行时，解析 `-`/`+` 前缀行，用 HTML `<span>` 包裹并添加 CSS 类名。

4. **`src/web/public/style.css`** — 新增 `.diff-added`（绿色）和 `.diff-removed`（红色）CSS 类。

## Todo List

- [x] 步骤 1 — 修改 `src/tools/edit.ts`：为成功替换生成带 ANSI 颜色的 diff 输出（红色 `-` 旧内容，绿色 `+` 新内容）
- [x] 步骤 2 — 修改 `src/agent/session.ts`：优化 edit 结果渲染，直接展示带颜色的 diff 内容
- [x] 步骤 3 — 修改 `src/web/public/app.js`：在 `addToolResult` 中识别 edit 输出的 diff 格式并用 HTML/CSS 渲染
- [x] 步骤 4 — 修改 `src/web/public/style.css`：新增 `.diff-added` 和 `.diff-removed` 样式类
- [x] 步骤 5 — 修复 `generateDiff` 空 oldStr 时产生空红色行的问题
- [x] 步骤 6 — 修复 CRLF（`\r\n`）未在 old_string/new_string 中归一化的问题（Windows 关键修复）
