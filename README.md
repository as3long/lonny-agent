# lonny — 用更少的调用做更多的事

> 一个专为 Coding Plan（5 小时 1200 次调用套餐）场景优化的 AI 编码代理，目标是用更少的 API 调用次数完成更多的工作。支持三模式操作（code/plan/ask）、多模型供应商、批量编辑和美观的终端界面。

---

## 功能特性

- **三模式操作**：`code` 模式直接编辑代码文件，`plan` 模式生成可执行的计划文档，`ask` 模式仅限问答和网络搜索
- **多模型支持**：兼容 Anthropic（Claude）、OpenAI（GPT）、Google（Gemini）、Ollama（本地模型），支持切换
- **批量编辑**：单次调用支持多文件、多位置的批量编辑，优化按调用付费的成本
- **语法高亮**：内置代码块语法高亮（TypeScript、Python、Rust、Go、Shell 等十余种语言）
- **会话持久化**：自动保存和恢复会话（`~/.lonny/sessions/`），支持 mid-turn 保存防止刷新数据丢失
- **Token 统计**：实时追踪输入/输出 token 用量和 API 调用次数
- **技能系统**：通过 `.lonny/skills/` 加载自定义技能提示（Markdown + frontmatter）
- **模板系统**：通过 `.lonny/prompts/` 加载可复用的提示模板，支持参数替换（`$1`, `$2`, `$@`）
- **计划管理**：`plan` 模式下生成可复用的计划文档（`.lonny/plans/`），TUI 中支持查看和筛选
- **思考过程展示**：支持 Anthropic/OpenAI 推理模型（thinking/reasoning_effort），实时流式显示思考过程
- **上下文压缩**：长对话自动压缩（超过 128K token 的 75%），保留关键上下文和工具调用结果
- **工具注册表**：可扩展的工具插件系统，支持动态注册/注销工具
- **exec 工具**：在沙箱中执行 JavaScript 代码，可编排多个工具调用
- **美观的 TUI**：像素字体 Logo、状态栏（cwd + 模式 + token 统计 + 模型）、Todo 侧边栏、实时加载动画
- **DeepSeek 余额查询**：自动查询 DeepSeek 账户余额并显示在状态栏
- **事件总线**：内部事件系统，支持 TUI 实时更新工具调用状态
- **Web UI**：通过浏览器访问的 Web 聊天界面，支持流式输出、工具调用可视化、工作目录展示、DeepSeek 余额查询、斜杠命令补全、会话历史恢复和模式/模型切换
- **代码质量管道**：内置 Biome 检查、Husky Git hooks、lint-staged 自动格式化

## 快速开始

### 安装

```bash
npm install -g lonny-agent
```

### 配置

配置文件 `~/.lonny/config.json`（通过 `lonny init` 自动生成）：

```json
{
  "provider": "openai",
  "model": "deepseek-v4-flash",
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-...",
  "autoApprove": false,
  "tavilyApiKey": "tvly-...",
  "thinking": false,
  "reasoningEffort": "medium",
  "contextWindow": 256000,
  "strictTools": true
}
```

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `provider` | 模型供应商：`openai`、`anthropic`、`google`、`ollama` | `openai` |
| `model` | 模型名称 | `deepseek-v4-flash` |
| `baseUrl` | API 地址 | `https://api.deepseek.com` |
| `apiKey` | API 密钥 | — |
| `autoApprove` | 自动批准工具执行（无需确认） | `false` |
| `tavilyApiKey` | Tavily 搜索 API 密钥 | — |
| `thinking` | 启用推理模型的思考过程展示 | `false` |
| `reasoningEffort` | 推理强度：`low`、`medium`、`high` | `medium` |
| `contextWindow` | 上下文窗口大小（token） | `256000` |
| `strictTools` | 严格模式工具调用（确保参数符合 schema） | `true` |

### 启动

```bash
# 启动交互式终端界面（TUI）
lonny

# 单次对话模式（非交互式）
lonny -p "你的问题"

# plan 模式
lonny --mode plan

# ask 模式
lonny --mode ask -p "什么是 Rust 的所有权系统？"

# Web UI 模式（浏览器访问 http://localhost:15090）
lonny --web

# 指定 Web UI 端口
lonny --web --port 8080
```

## 命令行参数

| 参数 | 说明 |
|------|------|
| `-p, --prompt <text>` | 单次对话模式，直接提问 |
| `--mode <code\|plan\|ask>` | 模式：`code`（编辑代码）、`plan`（制定计划）、`ask`（问答搜索） |
| `--auto-approve` | 自动批准工具执行（无需确认） |
| `--web` | 启动 Web UI 模式（通过浏览器访问） |
| `--port <num>` | Web UI 端口号（默认：15090） |

### DeepSeek 缓存支持

当使用 DeepSeek 模型时（模型名或 base URL 包含 `deepseek`），lonny 会自动启用 `enable_cache` 以利用 DeepSeek 的缓存功能，降低 API 调用成本。

DeepSeek v4 flash 的默认上下文窗口为 256K token，可通过配置文件的 `contextWindow` 调整。

## Web UI 使用指南

Lonny 提供了基于 WebSocket 的 Web 聊天界面，支持所有核心功能。

### 启动

```bash
# 启动 Web UI（默认端口 15090）
lonny --web

# 指定端口
lonny --web --port 8080
```

然后在浏览器中打开 `http://localhost:15090`。

### 功能

- **流式输出**：实时显示 AI 回复，逐字符流式渲染
- **工具调用可视化**：显示正在调用的工具及其结果
- **思考过程展示**：支持 Anthropic/OpenAI 推理模型的思考过程实时展示
- **工作目录展示**：状态栏显示当前工作目录
- **DeepSeek 余额查询**：自动查询并显示余额
- **会话历史恢复**：刷新后自动恢复对话历史
- **斜杠命令补全**：输入 `/` 自动弹出可用命令列表
- **模式切换**：通过 `/mode code|plan|ask` 切换模式
- **模型切换**：通过 `/model <name>` 切换模型
- **新会话**：通过 `/new` 开始新会话
- **查看技能**：通过 `/skills` 列出已加载技能
- **查看模板**：通过 `/prompts` 列出提示模板
- **初始化目录**：通过 `/init` 创建 `.lonny/skills/` 和 `.lonny/prompts/`
- **帮助**：通过 `/help` 查看所有命令
- **自动重连**：连接断开后自动重连（最多尝试 10 次）
- **心跳保活**：每 30 秒发送心跳保持连接

### WebSocket 消息协议

前后端通过 WebSocket 通信，消息格式为 JSON：

**客户端 → 服务器：**
```
{ type: "message", text: "..." }          // 发送消息
{ type: "load_plan", planName: "..." }    // 加载计划
{ type: "tool_confirm_response", approved: true/false }  // 工具确认
{ type: "stop" }                           // 停止
{ type: "ping" }                           // 心跳
```

**服务器 → 客户端：**
```
{ type: "hello", mode, model, provider, cwd, balance, totalIn, totalOut, totalApi }  // 初始状态
{ type: "session_history", messages: [...] }        // 会话历史
{ type: "chunk", text: "..." }                     // 流式文本
{ type: "thinking", text: "..." }                   // 思考过程
{ type: "thinking_end" }                             // 思考结束
{ type: "turn_start" }                               // 新轮次开始
{ type: "tool_call", name, input, id }               // 工具调用
{ type: "tool_result", name, success, output, id }   // 工具结果
{ type: "turn_end", iterations, toolCallCount }      // 轮次结束
{ type: "token_stats", turnIn, turnOut, totalIn, totalOut, turnApi, totalApi }  // Token 统计
{ type: "done", reason: "stop" | "error" }          // 完成
{ type: "error", message }                           // 错误
{ type: "mode_changed", mode }                       // 模式切换
{ type: "model_changed", model }                     // 模型切换
{ type: "session_cleared" }                          // 会话清除
{ type: "plan_written", display }                    // 计划已写入
{ type: "plan_data", plans, currentPlanName, todos }  // 计划/Todo 数据
{ type: "balance_update", balance, webBalance }      // 余额更新
{ type: "compaction", before, after }                // 上下文压缩
{ type: "tool_confirm_request", toolCalls }          // 工具执行确认
{ type: "help", commands }                           // 帮助信息
{ type: "pong" }                                     // 心跳响应
```

## TUI 使用指南

### 命令

| 命令 | 说明 |
|------|------|
| `/mode code\|plan\|ask` | 切换模式（代码编辑/计划制定/问答搜索） |
| `/model <name>` | 切换模型 |
| `/plans` | 查看计划列表 |
| `/prompts` | 查看提示模板列表 |
| `/skills` | 查看技能列表 |
| `/filter <query>` | 筛选计划列表 |
| `/new` | 开始新会话 |
| `/stop` | 停止正在运行的代理 |
| `/init` | 创建 `.lonny/skills/` 和 `.lonny/prompts/` 目录 |
| `/help` | 显示帮助信息 |
| `/exit` | 退出程序 |

### 快捷键

| 按键 | 说明 |
|------|------|
| `Enter` | 发送消息 |
| `↑/↓` | 浏览历史记录 |
| `Tab` | 自动补全命令 |
| `?` | 切换帮助面板 |

### 状态指示

- **光标闪烁**：闲置状态，可以输入
- **光标消失**：正在处理请求
- **头部状态栏**：显示 `● running`（运行中）或 `○ idle`（闲置）

## 配置目录结构

```
项目目录/
├── .lonny/
│   ├── skills/          # 自定义技能（.md 文件，支持 frontmatter）
│   ├── prompts/         # 提示模板（.md 文件，支持 $1, $2, $@ 参数替换）
│   └── plans/           # plan 模式下生成的计划文档
└── ...

~/.lonny/
├── config.json          # 全局配置文件
└── sessions/            # 自动保存的会话（按项目目录哈希命名）
```

### 技能文件示例（`.lonny/skills/my-skill.md`）

```markdown
---
name: my-skill
description: 我的自定义技能
---

在这里写自定义的 AI 行为指令...
```

### 提示模板示例（`.lonny/prompts/fix-typo.md`）

```markdown
---
name: fix-typo
description: 修复文件中的拼写错误
argument-hint: <file>
---

修复 $1 中的任何拼写错误
```

通过模板名称引用：`/prompts` 列出所有模板。

## 工具

lonny 为 AI 模型提供了以下工具：

| 工具 | 说明 | 可用模式 |
|------|------|----------|
| `read` | 读取文件内容 | code, plan |
| `glob` | 使用 glob 模式搜索文件 | code, plan |
| `grep` | 在文件中搜索文本 | code, plan |
| `ls` | 列出目录内容 | code, plan |
| `bash` | 执行 shell 命令 | code, plan |
| `find` | 按名称搜索文件 | code, plan |
| `git` | 执行只读 Git 操作 | code, plan |
| `edit` | 批量编辑文件（多文件多位置），提供详细的错误诊断和字段验证 | code |
| `write_plan` | 编写计划文档 | plan |
| `exec` | 在沙箱中执行 JavaScript 编排多个工具 | code |
| `install_skill` | 安装 npm 包或 ClawHub 技能 | code, plan |
| `fetch` | 获取 URL 内容 | code, plan, ask |
| `search` | 联网搜索（Tavily API） | code, plan, ask |

> **注意**：`search` 工具需要配置 Tavily API 密钥。在 `~/.lonny/config.json` 中添加 `"tavilyApiKey": "tvly-..."` 即可启用。

## 子代理（Sub-Agent / Delegate Tool）

子代理是一个内置的上下文优化工具，允许主 AI 将明确定义的子任务委托给一个全新的、上下文最小化的独立代理执行。

### 为什么需要子代理？

每轮对话的完整上下文都会被发送给 LLM，如果所有子任务都在主会话中完成，上下文会快速膨胀，导致：
- Token 消耗增加（每次 API 调用都要发送全部历史）
- 模型注意力分散（无关的上下文干扰当前任务）
- 成本上升（按 Token 计费）

子代理将这些子任务的上下文隔离在独立的 mini 会话中，只把最终摘要返回给主会话，大幅节省 token。

### 什么时候该用？

| 适合委托的场景 | 不适合委托的场景 |
|---------------|-----------------|
| 实现单个函数/模块 | 需要完整项目上下文的任务 |
| 编写单元测试 | 跨多文件的架构评审 |
| 修复已知的特定 bug | 需要长期记忆的任务 |
| 重构小模块（< 200 行） | 需要主会话记录完整中间步骤的任务 |
| 独立的工具编排任务 | 任意工具调用（主 agent：`code` 模式、`loop` 模式均可） |

### 使用方法

子代理通过 `delegate` 工具调用，有两种使用方式：

#### 方式一：自动使用（推荐）

在 `code` 或 `loop` 模式下，AI 会自动判断何时委托子任务。当发现一个明确定义的子任务时，它会自动调用 `delegate` 工具。

系统 prompt 中的规则已引导 AI 在合适场景使用子代理：

> **CONTEXT OPTIMIZATION**: For well-defined, self-contained subtasks that don't need the full conversation history, use `delegate` tool...

#### 方式二：手动触发（通过系统提示词引导）

你可以在提示词中明确建议 AI 使用子代理：

```text
重构 src/utils.ts 的 parseConfig 函数。请使用 delegate 让子代理实现，以减少上下文开销。

### 子代理的工作原理

```text
主会话 -> delegate({ task, context })
  |
  +-- 创建独立 mini 会话
  +-- 子代理循环（最多 5 次 LLM 调用）
  |   +-- 调用 LLM
  |   +-- 有工具调用 -> 执行 -> 继续
  |   +-- 无工具调用 -> 结束，返回摘要
  |
  +-- 返回摘要到主会话
      [Sub-Agent Stats: Iterations, Tool calls, Tokens saved]

### 子代理可以使用的工具

子代理可以调用主会话中的大部分工具（read、edit、bash、glob、grep、fetch、search 等），但 delegate 和 task_complete 被禁止调用。

### 注意事项

1. 默认最多 5 次 LLM 调用（可通过 maxIterations 参数调整，上限 15）
2. 子代理的 system prompt 包含平台信息（Windows/Linux、Shell 类型），能正确处理平台差异
3. Token 节省数据会显示在返回结果中

```bash
# 克隆仓库
git clone <repo-url>
cd lonny-agent

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建
npm run build

# 运行测试
npm test
```

### 代码质量

项目使用 [Biome](https://biomejs.dev/) 进行代码检查和格式化，通过 [Husky](https://typicode.github.io/husky/) Git hooks 自动执行：

```bash
# 手动检查和格式化
npm run check
npm run check:fix

# 提交前自动检查（通过 lint-staged）
npm run lint:fix
npm run format
```

支持的 Git hooks：
- **pre-commit**：对暂存的 `.ts`、`.js`、`.mjs` 文件运行 Biome 检查，对 `.json`、`.jsonc` 文件自动格式化
- **commit-msg**：验证提交信息是否符合 conventional commits 格式（如 `feat:`, `fix:`, `chore:` 等）

## 许可证

MIT
