# pi-agent 项目研究报告 + lonny-agent Web UI 实施计划

## pi-agent 是什么？

**pi-agent**（GitHub: `earendil-works/pi`，npm: `@earendil-works/pi`）是一个 TypeScript 构建的开源 AI 编码代理工具包，作者 Mario Zechner。它以 monorepo 结构组织：

| 包名 | 用途 |
|------|------|
| `@earendil-works/pi-ai` | 统一的 LLM API（支持 OpenAI、Anthropic、Google 等 15+ 提供商） |
| `@earendil-works/pi-agent-core` | 代理运行时，工具调用循环和状态管理 |
| `@earendil-works/pi-coding-agent` | 交互式编码代理 CLI |
| `@earendil-works/pi-tui` | 终端 UI 库（差分渲染） |
| `@earendil-works/pi-web-ui` | **Web UI 组件库** — 可复用的 Web 组件，用于构建 AI 聊天界面 |

### pi-agent 有 GUI 吗？

**有，但不是传统 GUI 应用**。pi-agent 提供的是：
1. **TUI（终端 UI）** — 通过 `@earendil-works/pi-tui` 提供，lonny-agent 已经在使用
2. **Web UI 组件库** — `@earendil-works/pi-web-ui` 提供可复用的 Web 组件（基于 mini-lit/web components），用于构建 AI 聊天界面
3. **社区 Web UI 服务器** — `khimaros/pi-webui` 是一个独立的 Web UI 服务器项目

pi-agent **本身没有内置的 Web UI 服务器**。`@earendil-works/pi-web-ui` 只是一个组件库，需要开发者自己搭建 HTTP 服务器来使用。

---

## lonny-agent 与 pi-agent 的关系

lonny-agent **已经使用了** `@earendil-works/pi-tui` 作为终端 UI（见 `src/tui/index.ts:3-21`），但**没有使用** pi-web-ui 或完整的 pi-agent-core。lonny 有自己的：

- **`Session` 类**（`src/agent/session.ts`）— 对话管理和 LLM 交互
- **`ToolRegistry`**（`src/tools/registry.ts`）— 工具注册和分发
- **`EventBus`**（`src/agent/event-bus.ts`）— 事件系统，用于 TUI 实时更新
- **各 LLM 提供商实现**（`src/agent/providers/`）— Anthropic、OpenAI、Google、Ollama

---

## 为 lonny-agent 添加 Web UI 的计划

### 推荐方案：自建轻量级 Web UI

```
lonny --web  →  HTTP 服务器 (Node.js http模块)
                     ↓
                WebSocket (ws包)
                     ↓
                Session + EventBus  ← 与 TUI 模式完全相同的核心
                     ↓
              前端 HTML/CSS/JS (单页应用)
              - 聊天界面 (流式显示)
              - 工具调用可视化
              - 模式切换
              - Token 统计
```

### 消息协议

```
客户端 → 服务器: { type: "message", text: "..." }
服务器 → 客户端: { type: "chunk", text: "..." }
服务器 → 客户端: { type: "tool_call", name: "...", input: {...} }
服务器 → 客户端: { type: "tool_result", name: "...", success: true/false, output: "..." }
服务器 → 客户端: { type: "token_stats", turnInput, turnOutput, totalInput, totalOutput, turnApi, totalApi }
服务器 → 客户端: { type: "thinking", text: "..." }
服务器 → 客户端: { type: "done", reason: "stop" | "error" | "max_iterations" }
服务器 → 客户端: { type: "error", message: "..." }
服务器 → 客户端: { type: "mode_changed", mode: "code" | "plan" | "ask" }
```

## Todo List

- [x] 1. **创建 `src/web/index.ts`** — HTTP 服务器 + WebSocket 服务（使用 Node.js 内置 `http` 模块和 `ws` 包）
- [x] 2. **创建 `src/web/session-bridge.ts`** — 桥接 Session 和 EventBus 到 WebSocket 消息
- [x] 3. **创建 `src/web/public/index.html`** — Web 聊天界面 HTML 骨架
- [x] 4. **创建 `src/web/public/style.css`** — 聊天界面样式（深色主题，类似 TUI 风格）
- [x] 5. **创建 `src/web/public/app.js`** — 前端 WebSocket 客户端逻辑（消息发送/接收、流式渲染、工具调用可视化）
- [x] 6. **修改 `src/cli/index.ts`** — 添加 `--web` 和 `--port` CLI 参数
- [x] 7. **修改 `src/index.ts`** — 添加 `--web` 模式分支，启动 Web 服务器
- [x] 8. **修改 `package.json`** — 添加 `ws` 依赖
- [x] 9. **更新 README.md** — 添加 Web UI 使用说明

### Post-implementation fixes:
- [x] 添加 THINKING_END 事件通道，修复 thinking 块关闭逻辑
- [x] thinking 块插入到 message 内部（而非外部）
- [x] thinking 块完成后保留在 DOM 中（标记为 done），不消失
- [x] tool-call / tool-result 使用不同 CSS 类，视觉分离
- [x] 每个 LLM 迭代触发独立的 TURN_START/TURN_END，工具调用分布到各自消息流中
- [x] TOKEN_STATS 事件通道，token 统计同步到前端
- [x] 斜杠命令提示面板（/mode /model /new /help）
