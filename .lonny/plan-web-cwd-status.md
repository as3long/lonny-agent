# Plan: Web UI 状态栏添加工作目录显示

## 修改文件

### 1. `src/web/index.ts` — 后端
在 `hello` 消息中增加 `cwd` 字段：
```ts
cwd: config.cwd,
```
添加在 `version` 之后。

### 2. `src/web/public/index.html` — HTML
在状态栏左侧（`<div class="status-left">` 内）添加：
```html
<span class="separator">|</span>
<span id="cwd-display" class="cwd-text"></span>
```
放在 `mode-display` 和 `</div>` 之间。

### 3. `src/web/public/app.js` — 前端 JS
- 添加 DOM 引用：`const cwdDisplay = document.getElementById('cwd-display')`
- 在 `hello` 消息处理中添加：
```js
cwdDisplay.textContent = msg.cwd || ''
```

### 4. `src/web/public/style.css` — 样式
添加：
```css
.cwd-text { color: var(--text-dim); font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
```

## Todo List
- [x] `src/web/index.ts` — hello 消息添加 `cwd: config.cwd`
- [x] `src/web/public/index.html` — 状态栏添加 cwd 元素
- [x] `src/web/public/app.js` — 添加 DOM 引用和消息处理
- [x] `src/web/public/style.css` — 添加 cwd 样式
- [x] 构建并验证
