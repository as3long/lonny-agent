# 新增 "ask" 模式 — 纯问答、仅联网搜索 + Tavily

## 需求
增加一个 `ask` 模式，该模式下：
- 禁止所有 bash 命令执行
- 禁止所有文件操作（读、写、编辑、glob 等）
- 仅允许 `fetch`（通用URL抓取）和 `tavily_search`（Tavily 搜索引擎API）

## 需要修改的文件

### 1. 恢复 `src/tools/tavily.ts`（从 dist/ 反编译）
从 `dist/tools/tavily.js` 和 `dist/tools/tavily.d.ts` 还原源文件。
- 接受 `apiKey` 参数
- 调用 `https://api.tavily.com/search` POST 接口
- 参数：`query` (必填), `maxResults` (可选, 默认5), `searchDepth` (可选, 默认basic)
- 返回格式化后的搜索结果

### 2. `src/tools/__tests__/tavily.test.ts`（从 dist/ 还原）

### 3. `src/config/index.ts`
- `mode: 'code' | 'plan'` → `'code' | 'plan' | 'ask'`
- 添加 `tavilyApiKey?: string` 到 `Config` 和 `JsonConfig`

### 4. `src/tools/registry.ts` — 核心权限控制
- `ToolContext` 添加 `tavilyApiKey?: string`
- `ToolContext.mode` 类型扩展为 `'code' | 'plan' | 'ask'`
- `registerBuiltins()` 中：`ask` 模式**仅注册 `fetch` 和 `tavily_search`**
- `setMode()` 中：切换到 `ask` 时，清空所有工具然后只保留 `fetch` + `tavily_search`；切出时恢复对应工具集

### 5. `src/agent/session.ts`
- `SessionData.mode` 类型扩展
- `buildSystemPrompt()` 增加 ask 模式的 system prompt：
  - 仅能使用 `fetch` 和 `tavily_search` 两类工具
  - 明确禁止 bash 和文件操作
  - 鼓励进行网络搜索来回答用户问题
- `setMode()` 参数类型扩展
- 创建 `ToolRegistry` 时传入 `tavilyApiKey`

### 6. `src/cli/index.ts`
- `--mode` 参数类型扩展为 `'code' | 'plan' | 'ask'`

### 7. `src/tui/index.ts`
- `/mode` 命令接受 `'ask'`
- 模式标签颜色：`'ask'` 使用绿色
- 帮助文本 `/mode` 提示改为 `code|plan|ask`
- `updateHeader()` 中的模式判断更新

### 8. `src/index.ts`
- 无变化（已通过 config 透传）

## ask 模式 system prompt 内容
```
You are a Q&A assistant. You can ONLY use the following tools to search for information:
- \`fetch\`: Fetch content from a URL
- \`tavily_search\`: Search the web using Tavily API

You CANNOT execute any shell commands (\`bash\`), read local files, or make any changes to the codebase.

RULES (ask-specific):
1. Use \`fetch\` and \`tavily_search\` to find information and answer user questions.
2. You CANNOT use \`bash\`, \`read\`, \`edit\`, \`write_plan\`, \`glob\`, \`grep\`, \`ls\`, \`find\`, or \`git\`.
3. If the user wants you to modify code or run commands, explain you are in ask mode and suggest switching to code mode.
```
