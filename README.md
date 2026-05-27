# lonny — 按调用付费的 AI 编码助手

> 一个专为按调用付费（per-call pricing）场景优化的 AI 编码代理，支持双阶段批量编辑和美观的终端界面。

---

## 功能特性

- **三模式操作**：`code` 模式直接编辑代码文件，`plan` 模式生成可执行的计划文档，`ask` 模式仅限问答和网络搜索
- **多模型支持**：兼容 Anthropic（Claude）、OpenAI（GPT）、Google（Gemini）、Ollama（本地模型）
- **批量编辑**：单次调用支持多文件、多位置的批量编辑，优化按调用付费的成本
- **语法高亮**：内置代码块语法高亮（TypeScript、Python、Rust、Go、Shell 等十余种语言）
- **会话持久化**：自动保存和恢复会话，断线后继续之前的对话
- **Token 统计**：实时追踪输入/输出 token 用量和 API 调用次数
- **技能系统**：通过 `.lonny/skills/` 加载自定义技能提示
- **模板系统**：通过 `.lonny/prompts/` 加载自定义提示模板
- **计划管理**：`plan` 模式下生成可复用的计划文档，支持查看和筛选
- **美观的 TUI**：像素字体 Logo、状态栏、折叠式工具输出、实时加载动画
- **代码质量管道**：内置 Biome 检查、Husky Git hooks、lint-staged 自动格式化
- **智能压缩**：长对话自动压缩，保留关键上下文和工具调用结果

## 快速开始

### 安装

```bash
npm install -g lonny-agent
```

### 配置

lonny 支持多种配置方式（优先级从高到低）：

1. **命令行参数**
2. **环境变量**
3. **配置文件 `~/.lonny/config.json`**

```bash
# 设置 API 密钥
export LONNY_API_KEY=sk-ant-...
# 或
export LONNY_API_KEY=sk-proj-...
```

示例配置文件 `~/.lonny/config.json`：

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "apiKey": "sk-ant-...",
  "thinking": true,
  "tavilyApiKey": "tvly-..."
}
```

### 启动

```bash
# 启动交互式终端界面（TUI）
lonny

# 单次对话模式（非交互式）
lonny -p "你的问题"

# 指定模型和提供商
lonny --provider openai --model gpt-4o
```

## 命令行参数

| 参数 | 说明 |
|------|------|
| `-p, --prompt <text>` | 单次对话模式，直接提问 |
| `--provider <name>` | AI 提供商：`anthropic`、`openai`、`google`、`ollama` |
| `--model <name>` | 模型名称 |
| `--api-key <key>` | API 密钥 |
| `--base-url <url>` | 自定义 API 地址（兼容 OpenAI 格式） |
| `--mode <code\|plan\|ask>` | 模式：`code`（编辑代码）、`plan`（制定计划）、`ask`（问答搜索） |
| `--auto-approve` | 自动批准工具执行（无需确认） |
| `--thinking` | 启用思考模式（仅 Anthropic） |
| `--reasoning-effort <level>` | 推理强度（仅 OpenAI）：`low`、`medium`、`high` |
| `--temperature <num>` | 生成温度（0-2），默认 0.3（code）/ 0（plan/ask） |
| `--max-tokens <num>` | 最大输出 token 数 |

### 环境变量

| 变量 | 说明 |
|------|------|
| `LONNY_API_KEY` | API 密钥 |
| `LONNY_PROVIDER` | AI 提供商 |
| `LONNY_MODEL` | 模型名称 |
| `LONNY_BASE_URL` | 自定义 API 地址 |

## TUI 使用指南

### 命令

| 命令 | 说明 |
|------|------|
| `/mode code\|plan\|ask` | 切换模式（代码编辑/计划制定/问答搜索） |
| `/model <name>` | 切换模型 |
| `/plans` | 查看计划列表 |
| `/prompts` | 查看提示模板列表 |
| `/skills` | 查看技能列表 |
| `/new` | 开始新会话 |
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
│   ├── skills/          # 自定义技能（.md 文件）
│   ├── prompts/         # 提示模板（.md 文件）
│   └── plans/           # 生成的计划文档（plan 模式）
└── ...
```

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
| `edit` | 编辑文件 | code |
| `write_plan` | 编写计划文档 | plan |
| `fetch` | 获取 URL 内容 | code, plan, ask |
| `search` | 联网搜索（Tavily API） | code, plan, ask |

> **注意**：`search` 工具需要配置 Tavily API 密钥。在 `~/.lonny/config.json` 中添加 `"tavilyApiKey": "tvly-..."` 即可启用。

## 开发

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
