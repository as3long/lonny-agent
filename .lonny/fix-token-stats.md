## Plan

**Root cause found!**

Token 文件 (`~/.lonny/tokens/lonny-agent-cbcbdb0917c3.json`) 中的值为 0。

经过追踪，问题出在 `src/agent/providers/openai.ts` 第 110 行：

```ts
const rawChunk = chunk as { usage?: { input_tokens?: number; output_tokens?: number } }
```

OpenAI 的 `ChatCompletionChunk.usage` 类型是 `CompletionUsage`（定义在 `node_modules/openai/resources/completions.d.ts:83`），实际字段是：
- `prompt_tokens` （不是 `input_tokens`）
- `completion_tokens` （不是 `output_tokens`）

代码用 `as` 断言强行转换类型但不改变运行时值。运行时 `chunk.usage` 的值为 `{ prompt_tokens: XXX, completion_tokens: YYY, total_tokens: ZZZ }`，所以：

- `rawChunk.usage.input_tokens` → `undefined` → `?? 0` → **0**
- `rawChunk.usage.output_tokens` → `undefined` → `?? 0` → **0**

然后 `lastUsage` 被设置为带有 `prompt_tokens`/`completion_tokens` 的对象，但后续代码始终读取 `lastUsage.input_tokens`/`lastUsage.output_tokens` → 始终为 0。

**修复方案：**

修改 `src/agent/providers/openai.ts`，正确映射 OpenAI 的字段名：
- `usage.prompt_tokens` → `input_tokens`
- `usage.completion_tokens` → `output_tokens`

涉及的所有位置（第 98、110-119、195-201、217-225、229-242 行）都需要更新。

---

## Todo List

- [ ] **`src/agent/providers/openai.ts:98`**: 将 `lastUsage` 的类型从 `{ input_tokens?: number; output_tokens?: number }` 改为 `{ prompt_tokens?: number; completion_tokens?: number }`
- [ ] **`src/agent/providers/openai.ts:110-119`**: 修改 `rawChunk` 类型断言为 `prompt_tokens`/`completion_tokens`，并在 yield complete 时正确映射
- [ ] **`src/agent/providers/openai.ts:195-201`**: 在 `lastUsage` 已到达时 yield complete 的 usage 映射
- [ ] **`src/agent/providers/openai.ts:216-225`**: 在 stream 结束前 flush pending complete 的 usage 映射
- [ ] **`src/agent/providers/openai.ts:229-242`**: 处理剩余 tool call 时的 usage 映射
- [ ] **测试验证**: 重启 app，发送消息，确认 token 值非零且在 header 中正确显示
