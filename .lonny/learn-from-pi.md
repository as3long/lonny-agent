# 学习 pi 项目并应用到 lonny-agent 的计划

## 项目概述

**pi (github.com/earendil-works/pi)** 是一个功能完整的 AI Agent 工具包，包含：
- `@earendil-works/pi-ai`: 统一的多提供商 LLM API (OpenAI, Anthropic, Google 等)
- `@earendil-works/pi-agent-core`: Agent 运行时，包含工具调用和状态管理
- `@earendil-works/pi-coding-agent`: 交互式编码 agent CLI
- `@earendil-works/pi-tui`: 终端 UI 库，带差异渲染

**lonny-agent** 当前已实现基础功能，但可以向 pi 学习以下改进点。

---

## 计划

### 高优先级

#### 1. 扩展 LLM 提供商支持 (src/agent/providers/)
**当前状态**: 仅支持 OpenAI 和 Anthropic  
**可学习**: pi-ai 支持 Google、Anthropic、OpenAI、Ollama 等多种提供商

**具体改进**:
- 添加 Google Gemini 提供商支持
- 添加本地 Ollama 支持
- 统一 Provider 接口，便于扩展

**相关文件**:
- `src/agent/providers/openai.ts` - 现有实现
- `src/agent/providers/anthropic.ts` - 现有实现
- 需要新建 `src/agent/providers/google.ts`, `src/agent/providers/ollama.ts`

---

#### 2. 上下文压缩/会话管理 (src/agent/session.ts)
**当前状态**: 简单保存完整消息历史，无压缩  
**可学习**: pi 的 compaction 系统管理长对话

**具体改进**:
- 实现 token 预算限制
- 添加会话压缩（保留关键上下文，压缩/总结旧消息）
- 支持会话分支/树形结构

**相关文件**:
- `src/agent/session.ts:296-341` - 现有会话持久化

---

#### 3. 扩展系统 (src/tools/)
**当前状态**: 固定工具集 (read, grep, glob, ls, bash, edit, write_plan)  
**可学习**: pi 的 Extension 系统可动态扩展工具

**具体改进**:
- 插件化工具注册机制
- 添加更多内置工具（如 find, sed, git 等）
- 支持自定义工具定义

**相关文件**:
- `src/tools/registry.ts:19-79` - 现有工具注册

---

### 中优先级

#### 4. 配置管理系统 (src/config/)
**当前状态**: 简单 JSON 配置  
**可学习**: pi 的 SettingsManager 和 AuthStorage

**具体改进**:
- 支持更多模型配置（temperature, max_tokens 等）
- API Key 安全存储（加密或系统密钥链）
- 用户偏好设置管理

**相关文件**:
- `src/config/index.ts:1-70` - 现有配置加载

---

#### 5. 会话统计和分析
**当前状态**: 仅追踪 token 使用  
**可学习**: pi 的 SessionStats 提供详细统计

**具体改进**:
- 追踪工具使用频率
- 成功/失败统计
- 会话时长分析
- 成本估算

**相关文件**:
- `src/config/tokens.ts` - 现有 token 追踪

---

#### 6. TUI 改进 (src/tui/)
**当前状态**: 自定义简单 TUI  
**可学习**: pi-tui 的高级组件

**具体改进**:
- 添加代码语法高亮渲染
- 支持终端图像显示 (kitty/iTerm2 协议)
- 改进的自动完成组件
- 模糊搜索支持

**相关文件**:
- `src/tui/index.ts` - 现有 TUI 实现

---

### 低优先级

#### 7. SDK /  programmatic API
**可学习**: pi 的 SDK 允许代码中调用 agent

**具体改进**:
- 提供库形式导入使用
- 支持无头模式运行

---

#### 8. 事件系统
**可学习**: pi 的 EventBus 用于组件间通信

**具体改进**:
- 工具调用事件
- 会话事件
- UI 事件

---

#### 9. Skills 系统
**可学习**: pi 的 Skills 允许自定义 prompt 片段

**具体改进**:
- 从目录加载自定义指令
- 内置技能市场（可选）

---

## Todo 列表

- [x] **高** 扩展 LLM 提供商 - 添加 Google Gemini 支持
- [x] **高** 扩展 LLM 提供商 - 添加本地 Ollama 支持
- [x] **高** 上下文压缩 - 实现 token 预算限制
- [x] **高** 上下文压缩 - 添加会话压缩功能
- [x] **高** 扩展系统 - 插件化工具注册机制
- [x] **高** 扩展系统 - 添加更多内置工具 (find, git)
- [x] **中** 配置管理 - 支持更多模型配置选项 (temperature, maxTokens)
- [ ] **中** 配置管理 - API Key 安全存储
- [ ] **中** 会话统计 - 追踪工具使用频率和成功/失败率
- [ ] **中** TUI 改进 - 代码语法高亮渲染
- [ ] **中** TUI 改进 - 终端图像显示支持
- [ ] **中** TUI 改进 - 改进的自动完成
- [ ] **低** SDK - 提供库形式导入使用
- [ ] **低** 事件系统 - 实现 EventBus
- [ ] **低** Skills - 实现自定义指令加载

---

## 风险与假设

1. **API 兼容性**: 扩展新提供商需要确保与现有接口兼容
2. **复杂度**: 上下文压缩和会话分支实现较复杂，需要仔细设计
3. **依赖**: 某些功能（如终端图像）需要底层终端支持
4. **优先级**: 高优先级功能应优先实现，确保核心体验提升