# AST 工具使用示例

`ast_query` 和 `ast_edit` 是基于 tree-sitter 的 AST 工具，支持 TypeScript、JavaScript 和 Python。

## ast_query

查询文件的抽象语法树结构。

### 基本查询

```
# 获取文件完整结构概览
ast_query path=src/utils.ts query=structure

# 仅查询函数
ast_query path=src/utils.ts query=functions

# 仅查询类
ast_query path=src/utils.ts query=classes

# 仅查询变量
ast_query path=src/utils.ts query=variables

# 仅查询导入
ast_query path=src/utils.ts query=imports

# 仅查询导出
ast_query path=src/utils.ts query=exports
```

### 按名称过滤

```
ast_query path=src/utils.ts query=functions nameFilter=formatDate
ast_query path=src/utils.ts query=classes nameFilter=UserService
```

### 查找引用（内联搜索）

```
ast_query path=src/utils.ts query=references nameFilter=formatDate
```

返回每个调用点的行号、列号和上下文代码行。

### Python 支持

```
ast_query path=src/main.py query=functions
ast_query path=src/main.py query=classes
```

---

## ast_edit

通过 AST 精确修改源代码，避免字符串替换的误伤。

### 替换节点 (replace-node)

```
ast_edit path=src/utils.ts editType=replace-node targetLine=5 newCode="function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}"
```

### 插入导入 (insert-import)

```
ast_edit path=src/utils.ts editType=insert-import importSource=./helpers importName=formatDate
```

### 重命名 (rename)

```
ast_edit path=src/utils.ts editType=rename oldName=oldFuncName newName=newFuncName
```

### 插入方法到类 (insert-method)

```
ast_edit path=src/services.ts editType=insert-method className=MyService methodCode="async getUser(id: string): Promise<User> {
  return this.db.find(id)
}"
```

---

## 工作流程示例

### 重构前检查

```
# 1. 查看所有调用点
ast_query path=src/api.ts query=references nameFilter=oldMethod

# 2. 重命名
ast_edit path=src/api.ts editType=rename oldName=oldMethod newName=newMethod

# 3. 验证
ast_query path=src/api.ts query=references nameFilter=newMethod
```

### 为类添加方法

```
# 1. 查看类结构
ast_query path=src/models.ts query=classes nameFilter=Product

# 2. 插入方法
ast_edit path=src/models.ts editType=insert-method className=Product methodCode="getDisplayName(): string {
  return this.name
}"

# 3. 验证结构
ast_query path=src/models.ts query=structure
```
