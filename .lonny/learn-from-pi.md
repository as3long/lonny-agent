# 学习 pi 项目并应用到 lonny-agent 的计划

## 项目概述

**pi (github.com/earendil-works/pi)** 是一个功能完整的 AI Agent 工具包，包含：
- `@earendil-works/pi-ai`: 统一的多提供商 LLM API (OpenAI, Anthropic, Google 等)
- `@earendil-works/pi-agent-core`: Agent 运行时，包含工具调用和状态管理
- `@earendil-works/pi-coding-agent`: 交互式编码 agent CLI
- `@earendil-works/pi-tui`: 终端 UI 库，带差异渲染

**lonny-agent** 当前已实现基础功能，已从 pi 学习并实现了高优先级功能。

---

## 已完成的高优先级功能

- [x] **扩展 LLM 提供商** - 添加 Google Gemini (`google.ts`) 和 Ollama (`ollama.ts`) 支持
- [x] **上下文压缩** - 实现 `compaction.ts`，包含 token 预算估计、自动压缩触发、智能摘要生成
- [x] **扩展系统** - 重构 `ToolRegistry`，支持插件化注册、`registerPlugin`/`unregister`/`has`/`listTools` 接口
- [x] **更多内置工具** - 添加 `find`（文件名搜索）和 `git`（只读 git 操作，带安全保护）
- [x] **配置扩展** - 添加 `temperature`、`maxTokens` 配置选项

---

## 可以继续学习的模块

### 高优先级

#### 1. Skills 系统 — 自定义指令加载
**pi 实现**: `packages/coding-agent/src/core/skills.ts`
- 从 `.pi/skills/` 目录加载 `.md` 文件作为 Skills
- 每个 Skill 有 frontmatter（name, description），内容为系统指令
- 支持 `.gitignore` 风格的忽略规则
- 支持 `disable-model-invocation` 标记（纯指令不调用模型）
- 验证 name 格式（小写字母、数字、连字符）

**lonny 借鉴方案**:
- 从 `.lonny/skills/` 目录加载 Markdown 文件
- 解析 frontmatter 获取 name/description
- 在 system prompt 中注入激活的 skills
- 支持 `/skills` 命令列出/切换 skills

**相关文件**: `src/agent/session.ts:183-258` (buildSystemPrompt)

---

#### 2. Prompt Templates 系统
**pi 实现**: `packages/coding-agent/src/core/prompt-templates.ts`
- 从 `.pi/prompts/` 加载模板文件
- 支持参数替换 (`$1`, `$2`, `$@`, `${@:N:L}`)
- 解析 frontmatter 获取名称和描述
- 注册为 `/template:name` 斜杠命令

**lonny 借鉴方案**:
- 从 `.lonny/prompts/` 加载模板
- 支持参数替换
- 注册为 `/` 命令

---

#### 3. 事件总线 (EventBus)
**pi 实现**: `packages/coding-agent/src/core/event-bus.ts`
- 基于 Node.js EventEmitter
- 类型安全的 `emit` / `on` 接口
- `on()` 返回取消订阅函数
- `clear()` 移除所有监听器

**lonny 借鉴方案**:
- 在 `src/agent/` 中添加 `event-bus.ts`
- 支持工具调用前后事件、会话事件、错误事件
- 用于 TUI 状态更新、日志记录、统计追踪

---

### 中优先级

#### 4. Auth 安全存储
**pi 实现**: `packages/coding-agent/src/core/auth-storage.ts`
- 文件级锁定防止竞态（`proper-lockfile`）
- 支持 API Key 和 OAuth 凭证
- 文件权限 `0o600`（仅所有者可读写）
- 支持 OAuth 刷新

**lonny 借鉴方案**:
- 实现文件锁定的安全存储
- 存储多提供商 API Key
- 支持环境变量回退

---

#### 5. 会话树形管理 (Session Tree)
**pi 实现**: `packages/coding-agent/src/core/session-manager.ts`
- 每个消息条目有 `id` / `parentId` 构成树形结构
- 支持分支、切换、回退
- 条目类型：message, compaction, branch_summary, custom, label
- 版本管理 (`CURRENT_SESSION_VERSION`)

**lonny 借鉴方案**:
- 改进 session 数据结构支持分支
- 添加会话分支/切换能力
- `/tree` 命令查看会话树

---

#### 6. 模型注册表 (Model Registry)
**pi 实现**: `packages/coding-agent/src/core/model-registry.ts`
- 内置模型列表（OpenAI、Anthropic、Google 等）
- 自定义模型配置（`models.json`）
- 思考级别管理（off/minimal/low/medium/high/xhigh）
- 路由配置（OpenRouter、Vercel Gateway）
- API Key 自动解析

**lonny 借鉴方案**:
- 内置常用模型列表
- 支持 `.lonny/models.json` 自定义模型
- 改进模型选择逻辑

---

#### 7. SDK / Programmatic API
**pi 实现**: `packages/coding-agent/src/core/sdk.ts`
- `createAgentSession()` 工厂函数
- `createReadOnlyTools()` / `createCodingTools()` 等工具工厂
- 支持自定义工具、自定义资源加载器
- 导出 `AgentSessionRuntime` 类型

**lonny 借鉴方案**:
- 导出 `createSession()` 供编程使用
- 工具工厂函数
- 支持无头模式

---

### 低优先级

#### 8. 资源加载器 (Resource Loader)
**pi 实现**: `packages/coding-agent/src/core/resource-loader.ts`
- 统一加载 Extensions、Skills、Prompts、Themes
- 支持 AGENTS.md / CLAUDE.md 项目上下文文件
- 包管理器集成（npm/git 包源）

---

#### 9. 终端图像支持
**pi 实现**: `packages/tui/src/terminal-image.ts`
- 检测终端能力（kitty、iTerm2）
- 图像编码和渲染
- 支持 GIF/PNG/JPEG/WebP

---

#### 10. 设置管理器 (Settings Manager)
**pi 实现**: `packages/coding-agent/src/core/settings-manager.ts`
- 全局/项目作用域配置
- 深层合并
- 丰富的设置项（compaction, retry, terminal, images, thinking budgets 等）

---

## 详细分析：pi 架构设计亮点

### 1. 分层解耦设计
```
pi-coding-agent/
├── core/
│   ├── agent-session.ts    # 核心会话逻辑（不依赖 UI）
│   ├── sdk.ts              # 编程接口（供第三方使用）
│   ├── extensions/         # 扩展系统
│   ├── tools/              # 工具系统
│   └── compaction/         # 压缩系统
├── modes/                  # 运行模式（交互/打印/RPC）
└── cli/                    # CLI 入口
```

**lonny 借鉴**: 当前 `src/agent/session.ts` 混入了大量 UI 渲染代码（颜色、格式）。应该分离为：
- `src/core/session.ts` — 纯会话逻辑
- `src/core/tools/` — 工具实现
- `src/tui/` — 纯 UI 渲染

### 2. 工具接口设计
pi 的每个工具都分为：
- `*ToolOptions` — 配置选项
- `*ToolInput` — LLM 调用输入 schema
- `*ToolDetails` — 完整工具定义
- `*Operations` — 操作接口（可注入，便于测试）
- `create*Tool(cwd, options)` — 工厂函数
- `create*ToolDefinition(cwd, options)` — 只创建定义（用于 SDK）

**lonny 借鉴**: 当前工具接口较简单，可以引入 Operations 接口增强可测试性。

### 3. 会话持久化设计
pi 使用基于文件的条目式存储，每个消息/事件是一个独立条目：
- 支持树形分支（id/parentId）
- 压缩条目保留摘要
- 自定义条目供扩展使用
- 版本控制

### 4. 事件驱动架构
EventBus 用于组件间解耦通信：
- TUI 更新
- 扩展生命周期
- 工具调用监控
- 状态变更通知

---

## 更新后的 Todo 列表

- [ ] **高** Skills 系统 - 从 `.lonny/skills/` 加载自定义指令
- [ ] **高** Prompt Templates - 从 `.lonny/prompts/` 加载模板
- [ ] **高** 事件总线 EventBus - 组件间解耦通信
- [ ] **中** Auth 安全存储 - 文件锁定、多 API Key 管理
- [ ] **中** 会话树形管理 - 支持分支/切换/回退
- [ ] **中** 模型注册表 - 内置模型列表、自定义模型
- [ ] **中** SDK / Programmatic API - 编程接口
- [ ] **中** 核心/UI 分离 - 重构 session.ts 分离渲染逻辑
- [ ] **低** 资源加载器 - 统一加载扩展/技能/模板
- [ ] **低** 终端图像支持 - 图片渲染
- [ ] **低** 设置管理器 - 丰富配置项

---

## 风险与假设

1. **API 兼容性**: 扩展新提供商需要确保与现有接口兼容
2. **复杂度**: 上下文压缩和会话分支实现较复杂，需要仔细设计
3. **依赖**: 某些功能（如终端图像）需要底层终端支持
4. **优先级**: 高优先级功能应优先实现，确保核心体验提升