import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as WTS from 'web-tree-sitter'

import type { AstAdapter } from './adapter.js'
import { detectLanguage } from './adapter.js'
import { walkStatements } from './tree-sitter-converters.js'
import type {
  AstEdit,
  Class,
  FuncDecl,
  Import,
  Module,
  Reference,
  Statement,
  TextEditResult,
  Variable,
} from './types.js'

function getWasmDir(): string {
  const modulePath = fileURLToPath(import.meta.url)
  return path.join(path.dirname(modulePath), 'wasm')
}

let initialized = false
let parser: WTS.Parser

async function initParser(): Promise<void> {
  if (initialized) return
  const wasmDir = getWasmDir()
  await WTS.Parser.init({
    locateFile: (wasmPath: string) => path.join(wasmDir, wasmPath),
  })
  parser = new WTS.Parser()
  initialized = true
}

function getWasmPath(lang: string): string {
  const wasmMap: Record<string, string> = {
    typescript: 'tree-sitter-typescript.wasm',
    javascript: 'tree-sitter-tsx.wasm',
    python: 'tree-sitter-python.wasm',
  }
  const filename = wasmMap[lang]
  if (!filename) throw new Error(`No WASM for language: ${lang}`)
  return path.join(getWasmDir(), filename)
}

function findNodeAtLine(root: WTS.Node, targetLine: number): WTS.Node | null {
  const targetZeroBased = targetLine - 1
  if (root.startPosition.row > targetZeroBased || root.endPosition.row < targetZeroBased) {
    return null
  }
  const primaryTypes = new Set([
    'function_declaration',
    'class_declaration',
    'lexical_declaration',
    'variable_declaration',
    'method_definition',
    'function_definition',
    'class_definition',
    'assignment',
    'export_statement',
    'import_statement',
  ])
  for (const child of root.namedChildren) {
    const found = findNodeAtLine(child, targetLine)
    if (found && primaryTypes.has(found.type)) return found
  }
  // Only return root if target line is at its EXACT start position.
  // This prevents replacing a large parent (e.g. entire class) when the target
  // line lands on whitespace or a gap between children.
  if (primaryTypes.has(root.type) && root.startPosition.row === targetZeroBased) return root
  return null
}

export function createTreeSitterAdapter(): AstAdapter {
  const languageCache = new Map<string, WTS.Language>()

  async function ensureParser(lang: string): Promise<void> {
    await initParser()
    if (!languageCache.has(lang)) {
      const wasmPath = getWasmPath(lang)
      const langModule = await WTS.Language.load(wasmPath)
      languageCache.set(lang, langModule)
    }
    parser.setLanguage(languageCache.get(lang)!)
  }

  function collectExports(statements: Statement[]): string[] {
    const exports: string[] = []
    for (const stmt of statements) {
      if (stmt.type === 'Export') {
        exports.push(stmt.name)
      }
    }
    return exports
  }

  return {
    async init() {
      await initParser()
    },

    supportedLanguages() {
      return ['typescript', 'javascript', 'python']
    },

    async parse(source: string, filePath: string): Promise<Module> {
      let lang: string
      try {
        lang = detectLanguage(filePath)
      } catch {
        return {
          type: 'Module',
          filePath,
          language: 'typescript',
          imports: [],
          body: [],
          exports: [],
        }
      }
      try {
        await ensureParser(lang)
      } catch {
        return {
          type: 'Module',
          filePath,
          language: lang as 'typescript' | 'javascript' | 'python',
          imports: [],
          body: [],
          exports: [],
        }
      }

      const tree = parser.parse(source)
      if (!tree) {
        return {
          type: 'Module',
          filePath,
          language: lang as 'typescript' | 'javascript' | 'python',
          imports: [],
          body: [],
          exports: [],
        }
      }

      const body = walkStatements(tree.rootNode, lang)
      const imports = body.filter((s): s is Import => s.type === 'Import')
      const exports = collectExports(body)

      return {
        type: 'Module',
        filePath,
        language: lang as 'typescript' | 'javascript' | 'python',
        imports,
        body,
        exports,
      }
    },

    findFunctions(node: Module, query?: { name?: string }): FuncDecl[] {
      return node.body.filter(
        (s): s is FuncDecl => s.type === 'Function' && (!query?.name || s.name === query.name),
      )
    },

    findClasses(node: Module, query?: { name?: string }): Class[] {
      return node.body.filter(
        (s): s is Class => s.type === 'Class' && (!query?.name || s.name === query.name),
      )
    },

    findVariables(node: Module, query?: { name?: string }): Variable[] {
      return node.body.filter(
        (s): s is Variable => s.type === 'Variable' && (!query?.name || s.name === query.name),
      )
    },

    getStructure(node: Module) {
      const imports = node.imports.map(i => ({
        source: i.source,
        names: i.specifiers.map(s => s.localName),
      }))

      const functions = node.body
        .filter((s): s is FuncDecl => s.type === 'Function')
        .map(f => ({ name: f.name, line: f.startLine }))

      const classes = node.body
        .filter((s): s is Class => s.type === 'Class')
        .map(c => ({
          name: c.name,
          line: c.startLine,
          methods: c.members.map(m => m.name),
        }))

      const variables = node.body
        .filter((s): s is Variable => s.type === 'Variable')
        .map(v => ({ name: v.name, line: v.startLine }))

      return {
        filePath: node.filePath,
        language: node.language,
        imports,
        exports: node.exports,
        functions,
        classes,
        variables,
      }
    },

    async applyEdits(source: string, filePath: string, edits: AstEdit[]): Promise<TextEditResult> {
      let lang: string
      try {
        lang = detectLanguage(filePath)
      } catch (err) {
        return { success: false, source, editsApplied: 0, error: `Unsupported file: ${err}` }
      }
      try {
        await ensureParser(lang)
      } catch (err) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Failed to initialize parser: ${err}`,
        }
      }

      const tree = parser.parse(source)
      if (!tree) {
        return { success: false, source, editsApplied: 0, error: 'Failed to parse source' }
      }

      let result = source
      let applied = 0
      let offsetDelta = 0

      for (const edit of edits) {
        const adjStart = edit.startOffset + offsetDelta
        const adjEnd = edit.endOffset != null ? edit.endOffset + offsetDelta : adjStart

        try {
          switch (edit.type) {
            case 'insert':
              result = result.slice(0, adjStart) + (edit.text || '') + result.slice(adjStart)
              offsetDelta += (edit.text || '').length
              break
            case 'replace':
              result = result.slice(0, adjStart) + (edit.text || '') + result.slice(adjEnd)
              offsetDelta += (edit.text || '').length - (adjEnd - adjStart)
              break
            case 'delete':
              result = result.slice(0, adjStart) + result.slice(adjEnd)
              offsetDelta -= adjEnd - adjStart
              break
          }
          applied++
        } catch (err) {
          return {
            success: false,
            source: result,
            editsApplied: applied,
            error: `Edit failed at offset ${edit.startOffset}: ${err}`,
          }
        }
      }

      return { success: true, source: result, editsApplied: applied }
    },

    async replaceNode(
      source: string,
      filePath: string,
      targetLine: number,
      newCode: string,
    ): Promise<TextEditResult> {
      let lang: string
      try {
        lang = detectLanguage(filePath)
      } catch (err) {
        return { success: false, source, editsApplied: 0, error: `Unsupported file: ${err}` }
      }
      try {
        await ensureParser(lang)
      } catch (err) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Failed to initialize parser: ${err}`,
        }
      }

      const tree = parser.parse(source)
      if (!tree) {
        return { success: false, source, editsApplied: 0, error: 'Failed to parse source' }
      }

      const targetNode = findNodeAtLine(tree.rootNode, targetLine)
      if (!targetNode) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `No node found at line ${targetLine}`,
        }
      }

      const startByte = targetNode.startIndex
      const endByte = targetNode.endIndex
      const newSource = source.slice(0, startByte) + newCode + source.slice(endByte)

      return { success: true, source: newSource, editsApplied: 1 }
    },

    async findReferences(source: string, filePath: string, name: string): Promise<Reference[]> {
      let lang: string
      try {
        lang = detectLanguage(filePath)
      } catch {
        return []
      }

      // Only supported for JS/TS (Python uses different AST node types)
      if (lang === 'python') return []

      try {
        await ensureParser(lang)
        const tree = parser.parse(source)
        if (!tree) return []

        const refs: Reference[] = []
        const root = tree.rootNode

        // Walk all nodes to find call_expression nodes
        function walk(node: WTS.Node): void {
          if (node.type === 'call_expression') {
            const funcNode = node.childForFieldName('function')
            if (funcNode) {
              // For simple calls like foo(), get the identifier text
              // For method calls like obj.foo(), get the property name
              let funcName: string | null = null
              if (funcNode.type === 'identifier') {
                funcName = funcNode.text
              } else if (funcNode.type === 'property_identifier') {
                funcName = funcNode.text
              } else if (funcNode.type === 'member_expression') {
                // a.b() → get the property (last identifier)
                const prop = funcNode.childForFieldName('property')
                if (prop) funcName = prop.text
              }

              if (funcName === name) {
                const line = funcNode.startPosition.row + 1
                const column = funcNode.startPosition.column
                // Extract context line from source
                const contextLine = source.split('\n')[line - 1]?.trim() || ''
                refs.push({
                  type: 'Reference',
                  name,
                  line,
                  column,
                  context: contextLine,
                })
              }
            }
          }

          // Recurse into children
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (child) walk(child)
          }
        }

        walk(root)
        return refs
      } catch {
        return []
      }
    },

    async insertMethodIntoClass(
      source: string,
      filePath: string,
      className: string,
      methodCode: string,
    ): Promise<TextEditResult> {
      let lang: string
      try {
        lang = detectLanguage(filePath)
      } catch (err) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Unsupported file: ${err}`,
        }
      }
      try {
        await ensureParser(lang)
      } catch (err) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Failed to initialize parser: ${err}`,
        }
      }

      const tree = parser.parse(source)
      if (!tree) {
        return { success: false, source, editsApplied: 0, error: 'Failed to parse source' }
      }

      // Find the class declaration node by name
      function findClass(node: WTS.Node): WTS.Node | null {
        if (node.type === 'class_declaration' || node.type === 'class_definition') {
          const nameNode = node.childForFieldName('name')
          if (nameNode && nameNode.text === className) return node
        }
        for (const child of node.namedChildren) {
          const found = findClass(child)
          if (found) return found
        }
        return null
      }

      const classNode = findClass(tree.rootNode)
      if (!classNode) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Class "${className}" not found`,
        }
      }

      // Find the class_body node
      const bodyNode = classNode.childForFieldName('body')
      if (!bodyNode) {
        return {
          success: false,
          source,
          editsApplied: 0,
          error: `Class "${className}" has no body`,
        }
      }

      // Insert before the closing brace of the class body
      const insertPos = bodyNode.endIndex - 1

      // Add proper indentation based on the class body start column
      const indent = ' '.repeat(bodyNode.startPosition.column + 2)
      const indentedMethod =
        methodCode
          .split('\n')
          .map((line, i) => (i === 0 ? `\n${indent}${line}` : `\n${indent}${line}`))
          .join('') + '\n'

      const newSource = source.slice(0, insertPos) + indentedMethod + source.slice(insertPos)

      return { success: true, source: newSource, editsApplied: 1 }
    },
  }
}
