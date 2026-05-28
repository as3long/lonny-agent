# 将 autoApprove 加入 config.json

## 改动清单

### 1. `src/config/index.ts` — JsonConfig 接口 + loadConfig 读取

- `JsonConfig` 接口新增 `autoApprove?: boolean` 字段
- `loadConfig()` 中 `autoApprove` 的 fallback 链改为：`options?.autoApprove ?? jsonConfig.autoApprove ?? false`
  - CLI 的 `--auto-approve` 优先级最高
  - 其次 config.json 中的 `"autoApprove": true/false`
  - 默认 `false`

### 2. `src/cli/init.ts` — init 向导增加步骤

- `JsonConfig` 接口（第66行附近）新增 `autoApprove?: boolean`
- 在 "Step 8: Tavily API Key" **之后**，新增一步 "Auto-approve tool calls?"：

```typescript
// ── Step 9: Auto-approve ──
const autoApprove = await askConfirm(
  rl,
  'Auto-approve tool calls? (no confirmation prompts)',
  existing.autoApprove ?? false,
)
```

- 在 `config` 对象构建（第276行附近）中添加：
```typescript
autoApprove: autoApprove || undefined,
```

### 3. `README.md` — 文档更新

- `~/.lonny/config.json` 示例中添加 `"autoApprove": true` 一行
- 命令行参数表中保留 `--auto-approve` 说明

## 执行

切换到 code 模式后：
1. 编辑 `src/config/index.ts` — 2处改动
2. 编辑 `src/cli/init.ts` — 3处改动（接口 + 步骤 + config构建）
3. 编辑 `README.md` — 1处改动
