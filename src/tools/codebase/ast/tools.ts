import type { Tool } from '../../types.js'
import { createTreeSitterAdapter } from './tree-sitter-adapter.js'

function resolvePath(input: Record<string, unknown>): string | undefined {
  return (input.path || input.file || input.filePath) as string | undefined
}

export function createAstTools(): Tool[] {
  const adapter = createTreeSitterAdapter()

  const astQueryTool: Tool = {
    definition: {
      name: 'ast_query',
      category: 'Codebase',
      group: 'AST',
      description:
        'Query the abstract syntax tree of a source file. Returns structured information about functions, classes, variables, imports, and exports. Useful for understanding code structure or finding code locations before editing.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path to query',
          required: true,
        },
        query: {
          type: 'string',
          description:
            'What to query: "structure", "functions", "classes", "variables", "imports", "exports"',
          required: true,
        },
        nameFilter: {
          type: 'string',
          description: 'Optional name filter (function name, class name, variable name)',
          required: false,
        },
      },
    },
    async execute(input) {
      const filePath = resolvePath(input)
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, output: '', error: 'path is required' }
      }

      const query = input.query as string | undefined
      if (!query || typeof query !== 'string') {
        return { success: false, output: '', error: 'query is required' }
      }

      const validQueries = ['structure', 'functions', 'classes', 'variables', 'imports', 'exports']
      if (!validQueries.includes(query)) {
        return {
          success: false,
          output: '',
          error: `Invalid query "${query}". Valid: ${validQueries.join(', ')}`,
        }
      }

      const nameFilter = input.nameFilter as string | undefined

      try {
        const fs = await import('node:fs')
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            output: '',
            error: `File not found: ${filePath}`,
          }
        }
        const source = fs.readFileSync(filePath, 'utf-8')
        const module = await adapter.parse(source, filePath)

        switch (query) {
          case 'structure': {
            const structure = adapter.getStructure(module)
            return { success: true, output: JSON.stringify(structure, null, 2) }
          }
          case 'functions': {
            const functions = adapter.findFunctions(
              module,
              nameFilter ? { name: nameFilter } : undefined,
            )
            return { success: true, output: JSON.stringify(functions, null, 2) }
          }
          case 'classes': {
            const classes = adapter.findClasses(
              module,
              nameFilter ? { name: nameFilter } : undefined,
            )
            return { success: true, output: JSON.stringify(classes, null, 2) }
          }
          case 'variables': {
            const variables = adapter.findVariables(
              module,
              nameFilter ? { name: nameFilter } : undefined,
            )
            return { success: true, output: JSON.stringify(variables, null, 2) }
          }
          case 'imports': {
            return { success: true, output: JSON.stringify(module.imports, null, 2) }
          }
          case 'exports': {
            return { success: true, output: JSON.stringify(module.exports, null, 2) }
          }
          default:
            return { success: false, output: '', error: `Unknown query: ${query}` }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          success: false,
          output: '',
          error: `AST query failed: ${message}`,
        }
      }
    },
  }

  const astEditTool: Tool = {
    definition: {
      name: 'ast_edit',
      category: 'Codebase',
      group: 'AST',
      description:
        'Modify source code using the AST. Unlike the plain edit tool which does string-based replacement, ast_edit understands code structure — it can replace a function body, insert a new method into a class, add an import, or change a variable declaration while preserving all formatting and comments.',
      parameters: {
        path: {
          type: 'string',
          description: 'File path to edit',
          required: true,
        },
        editType: {
          type: 'string',
          description:
            'Type of edit: "replace-node" (replace an entire function/class/variable at a given line), "insert-import" (add an import statement), "rename" (rename a symbol)',
          required: true,
        },
        targetLine: {
          type: 'number',
          description: 'Line number of the node to replace (for replace-node)',
          required: false,
        },
        newCode: {
          type: 'string',
          description: 'The new source code for the replacement (for replace-node)',
          required: false,
        },
        importSource: {
          type: 'string',
          description: 'Module path for insert-import',
          required: false,
        },
        importName: {
          type: 'string',
          description: 'Import name for insert-import',
          required: false,
        },
        oldName: {
          type: 'string',
          description: 'Current symbol name (for rename)',
          required: false,
        },
        newName: {
          type: 'string',
          description: 'New symbol name (for rename)',
          required: false,
        },
      },
    },
    async execute(input) {
      const filePath = resolvePath(input)
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, output: '', error: 'path is required' }
      }

      const editType = input.editType as string | undefined
      if (!editType || typeof editType !== 'string') {
        return { success: false, output: '', error: 'editType is required' }
      }

      const validEditTypes = ['replace-node', 'insert-import', 'rename']
      if (!validEditTypes.includes(editType)) {
        return {
          success: false,
          output: '',
          error: `Invalid editType "${editType}". Valid: ${validEditTypes.join(', ')}`,
        }
      }

      try {
        const fs = await import('node:fs')
        if (!fs.existsSync(filePath)) {
          return { success: false, output: '', error: `File not found: ${filePath}` }
        }

        let source = fs.readFileSync(filePath, 'utf-8')

        switch (editType) {
          case 'replace-node': {
            const targetLine = input.targetLine as number | undefined
            const newCode = input.newCode as string | undefined
            if (!targetLine || !newCode) {
              return {
                success: false,
                output: '',
                error: 'targetLine and newCode are required for replace-node',
              }
            }
            const result = await adapter.replaceNode(source, filePath, targetLine, newCode)
            if (result.success) {
              fs.writeFileSync(filePath, result.source, 'utf-8')
            }
            return {
              success: result.success,
              output: result.success ? `Replaced node at line ${targetLine}` : '',
              error: result.error,
            }
          }

          case 'insert-import': {
            const importSource = input.importSource as string | undefined
            const importName = input.importName as string | undefined
            if (!importSource || !importName) {
              return {
                success: false,
                output: '',
                error: 'importSource and importName are required for insert-import',
              }
            }
            const importStmt = `import ${importName} from '${importSource}'\n`
            source = importStmt + source
            fs.writeFileSync(filePath, source, 'utf-8')
            return { success: true, output: `Inserted import: ${importStmt.trim()}` }
          }

          case 'rename': {
            const oldName = input.oldName as string | undefined
            const newName = input.newName as string | undefined
            if (!oldName || !newName) {
              return {
                success: false,
                output: '',
                error: 'oldName and newName are required for rename',
              }
            }
            const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const regex = new RegExp(`\\b${escaped}\\b`, 'g')
            source = source.replace(regex, newName)
            fs.writeFileSync(filePath, source, 'utf-8')
            return { success: true, output: `Renamed "${oldName}" to "${newName}"` }
          }

          default:
            return { success: false, output: '', error: `Unknown editType: ${editType}` }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, output: '', error: `AST edit failed: ${message}` }
      }
    },
  }

  return [astQueryTool, astEditTool]
}
