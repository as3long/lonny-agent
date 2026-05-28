# 优化 autoApprove 确认流程

## 现状

`autoApprove` 字段已存储在 `ToolContext` 中，但**从未被实际使用** — 所有工具调用在 `session.ts:615-643` 中直接通过 `registry.dispatch(tc)` 执行，没有任何用户确认环节。无论 `autoApprove` 是 `true` 还是 `false`，行为完全相同。

三种运行模式（TUI、Web UI、CLI 单次）均缺失确认流程。

## 方案

在 `SessionOutput` 中添加可选的 `confirmTool` 回调函数。当 `autoApprove === false` 且有工具需要执行时，`session.chat()` 在 dispatch 前调用此回调等待用户确认。

三种模式各自实现 `confirmTool`：
- **TUI**：在 chat 区域展示工具列表，监听键盘输入 y/n，展示 y/N 提示
- **Web UI**：通过 WebSocket 发送 `tool_confirm_request` 给前端，等待 `tool_confirm_response`
- **CLI 单次**：使用 `readline` 从 stdin 读取 y/n

### Step 1 — 在 `SessionOutput` 接口中添加 `confirmTool` 回调

`src/agent/session.ts:95-99`

```typescript
export interface SessionOutput {
  write: (text: string) => void
  suppressToolOutput?: boolean
  /** 当 autoApprove 为 false 时调用，返回 true=允许执行, false=跳过。toolCalls 为整批工具。*/
  confirmTool?: (toolCalls: ToolCall[]) => Promise<boolean>
}
```

### Step 2 — 在 `session.chat()` 的工具执行循环中插入确认步骤

`src/agent/session.ts:615-643`

在 `for (const tc of toolCalls)` 循环之前添加：

```typescript
// ── 用户确认（仅对写操作工具） ──
if (!this.config.autoApprove && this.output?.confirmTool && toolCalls.length > 0) {
  // 只对写操作工具要求确认，只读工具自动放行
  const writeTools = ['edit', 'bash', 'write_plan', 'exec', 'install_skill']
  const needsConfirm = toolCalls.filter(tc => writeTools.includes(tc.name))
  if (needsConfirm.length > 0) {
    const approved = await this.output.confirmTool(toolCalls)
    if (!approved) {
      // 用户拒绝 — 将拒绝信息注入消息，让 LLM 可以重新规划
      const rejectMsg: LLMMessage = {
        role: 'tool',
        content: 'USER_REJECTED: The user declined to execute the requested tool calls. Try a different approach.',
        tool_call_id: toolCalls[0].id,
        name: 'user_feedback',
      }
      this.messages.push(rejectMsg)
      break
    }
  }
}
```

设计要点：
- 只对 `edit`、`bash`、`write_plan`、`exec`、`install_skill` 等有副作用的工具要求确认，`read`/`glob`/`grep` 等只读工具自动放行
- 用户拒绝时不终止会话，而是注入一条反馈消息让 LLM 重新规划
- 所有工具整批展示，用户一次确认，避免逐工具确认的烦琐

### Step 3 — TUI 实现确认提示

`src/tui/index.ts:155-163`

在 `SessionOutput` 创建处添加 `confirmTool`：

```typescript
const output: SessionOutput = {
  write: (text: string) => { /* 已有代码 */ },
  suppressToolOutput: false,
  confirmTool: async (toolCalls) => {
    // 展示工具列表
    chatContent += `\n  ${colors.warn('Allow these tool calls?')}\n`
    for (const tc of toolCalls) {
      const detail = formatToolInput(tc)
      chatContent += `  ${colors.dim('•')} ${colors.accent(tc.name)}${detail ? ` ${colors.dim(detail)}` : ''}\n`
    }
    chatContent += `  ${colors.inputPrompt('(y/N)')} `
    chatMarkdown.setText(chatContent)
    tui.requestRender(true)

    return new Promise(resolve => {
      const handler = (data: string) => {
        const key = data.trim().toLowerCase()
        if (key === 'y' || key === 'yes') {
          tui.removeInputListener(handler)
          chatContent += 'y\n'
          chatMarkdown.setText(chatContent)
          resolve(true)
        } else if (key === 'n' || key === 'no' || key === '\r' || key === '') {
          tui.removeInputListener(handler)
          chatContent += 'N\n'
          chatMarkdown.setText(chatContent)
          resolve(false)
        }
      }
      tui.addInputListener(handler)
    })
  },
}
```

### Step 4 — Web UI 实现确认提示

`src/web/index.ts:100-108`

在 Web UI 的 `output` 中添加 `confirmTool`，通过 WebSocket 与前端通信：

```typescript
let pendingConfirm: ((approved: boolean) => void) | null = null

const output = {
  write: (text: string) => { /* 已有代码 */ },
  suppressToolOutput: true,
  confirmTool: async (toolCalls) => {
    // 向前端发送确认请求
    ws.send(JSON.stringify({
      type: 'tool_confirm_request',
      toolCalls: toolCalls.map(tc => ({
        name: tc.name,
        input: tc.input,
        id: tc.id,
      })),
    }))

    // 等待前端响应
    return new Promise<boolean>(resolve => {
      pendingConfirm = resolve
    })
  },
}
```

在 `ws.on('message')` 处理中（`src/web/index.ts:183`）添加对 `tool_confirm_response` 消息的处理：

```typescript
} else if (msg.type === 'tool_confirm_response') {
  if (pendingConfirm) {
    pendingConfirm(msg.approved === true)
    pendingConfirm = null
  }
}
```

同时需要更新 `src/web/public/index.html` 前端代码，添加确认弹窗 UI。在前端 `tool_confirm_request` 消息处理器中展示一个确认对话框（显示工具名称和输入摘要），用户点击"允许"或"拒绝"后发送 `tool_confirm_response`。

### Step 5 — CLI 单次模式（`lonny -p`）实现确认提示

`src/agent/index.ts`

```typescript
import * as readline from 'node:readline'
import type { SessionOutput } from './session.js'

export async function runAgent(prompt: string, config: Config): Promise<void> {
  const output: SessionOutput = {
    write: (text) => process.stdout.write(text),
    confirmTool: async (toolCalls) => {
      console.log('\nAllow these tool calls?')
      for (const tc of toolCalls) {
        const input = JSON.stringify(tc.input)
        console.log(`  • ${tc.name}: ${input.slice(0, 120)}`)
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      return new Promise(resolve => {
        rl.question('  (y/N) ', answer => {
          rl.close()
          resolve(answer.trim().toLowerCase() === 'y')
        })
      })
    },
  }
  const session = Session.load(config, output) || new Session(config, output)
  await session.chat(prompt)
}
```

注意：`Session.load()` 目前不接受第二个参数（`src/agent/session.ts:298-331`），需要修改其签名，增加可选的 `output` 参数，或者在调用后设置 `session.output`。

### Step 6 — 修复 `Session.load()` 以支持传 `output`

`src/agent/session.ts:298`

```typescript
static load(config: Config, output?: SessionOutput): Session | null {
  // ... 已有逻辑 ...
  const session = new Session(config, output)
  // 确保 output 被传递到新创建的 session
  session.output = output
  // ...
}
```

## 修改清单

| 文件 | 改动 |
|------|------|
| `src/agent/session.ts:95-99` | `SessionOutput` 添加 `confirmTool` 回调类型 |
| `src/agent/session.ts:~615` | 工具执行循环前插入确认步骤 |
| `src/agent/session.ts:298` | `Session.load()` 增加 `output` 参数 |
| `src/tui/index.ts:~155` | TUI 的 `SessionOutput` 添加 `confirmTool` 实现 |
| `src/web/index.ts:100-108` | Web UI 的 `SessionOutput` 添加 `confirmTool` + pendingConfirm |
| `src/web/index.ts:~183` | 添加 `tool_confirm_response` 消息处理 |
| `src/web/public/index.html` | 前端添加确认弹窗 UI（展示工具列表 + 允许/拒绝按钮） |
| `src/agent/index.ts` | CLI 单次模式添加 `confirmTool` 实现 |
| `src/web/public/index.html` | ⏳ 前端确认弹窗 UI（待前端实现） |

---

**状态：✅ 后端逻辑全部完成。** Web UI 前端需要额外添加 `tool_confirm_request` 消息处理（展示确认弹窗），此部分属于前端代码，不在本次后端改动范围内。
