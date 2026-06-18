import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as WTS from 'web-tree-sitter'

import type { AstAdapter } from './adapter.js'
import { detectLanguage } from './adapter.js'
import type {
  AstEdit,
  Class,
  ClassMember,
  FuncDecl,
  Import,
  Module,
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

function walkStatements(node: WTS.Node, lang: string): Statement[] {
  const statements: Statement[] = []
  for (const child of node.children) {
    const stmt = convertNode(child, lang)
    if (stmt) {
      statements.push(stmt)
    }
    if (
      lang !== 'python' &&
      (child.type === 'lexical_declaration' || child.type === 'variable_declaration')
    ) {
      for (const decl of child.children) {
        if (decl.type === 'variable_declarator') {
          for (const valChild of decl.children) {
            if (valChild.type === 'arrow_function' || valChild.type === 'function') {
              statements.push(convertFunction(valChild))
            }
          }
        }
      }
    }
  }
  return statements
}

function convertNode(node: WTS.Node, lang: string): Statement | null {
  const type = node.type

  if (lang === 'typescript' || lang === 'javascript') {
    if (type === 'function_declaration') return convertFunction(node)
    if (type === 'arrow_function') return convertFunction(node)
    if (type === 'class_declaration') return convertClass(node)
    if (type === 'lexical_declaration') return convertLexicalDeclaration(node)
    if (type === 'variable_declaration') return convertVariableDeclaration(node)
    if (type === 'var_declaration') return convertVariableDeclaration(node)
    if (type === 'import_statement') return convertImport(node)
    if (type === 'import_declaration') return convertImport(node)
    if (type === 'export_statement' || type === 'export_named_statement') return convertExport(node)
    if (type === 'export_default_statement' || type === 'export_default')
      return convertExportDefault(node)
    if (type === 'generator_function_declaration') return convertFunction(node)
    if (type === 'generator_function') return convertFunction(node)
  }

  if (lang === 'python') {
    if (type === 'function_definition') return convertPythonFunction(node)
    if (type === 'class_definition') return convertPythonClass(node)
    if (type === 'assignment') return convertPythonAssignment(node)
    if (type === 'import_statement') return convertPythonImport(node)
    if (type === 'import_from_statement') return convertPythonImportFrom(node)
    if (type === 'decorated_definition') return convertDecoratedDefinition(node)
  }

  return null
}

function convertFunction(node: WTS.Node): FuncDecl {
  const nameNode = node.childForFieldName('name')
  const paramsNode = node.childForFieldName('parameters')
  const returnTypeNode = node.childForFieldName('return_type')
  const asyncNode = node.children.find(c => c.type === 'async')
  const isGenerator =
    node.type === 'generator_function_declaration' ||
    !!node.children.find(c => c.type === '*' || c.type === 'yield')

  const parameters: { name: string }[] = []
  if (paramsNode) {
    for (const param of paramsNode.children) {
      if (
        param.type === 'identifier' ||
        param.type === 'required_parameter' ||
        param.type === 'optional_parameter'
      ) {
        const name =
          param.childForFieldName('pattern')?.text ||
          param.childForFieldName('name')?.text ||
          param.text
        parameters.push({ name })
      } else if (param.type === 'assignment_pattern') {
        const left = param.childForFieldName('left')
        if (left) parameters.push({ name: left.text })
      }
    }
  }

  return {
    type: 'Function',
    name: nameNode?.text || null,
    parameters,
    returnType: returnTypeNode?.text || undefined,
    isAsync: !!asyncNode,
    isGenerator,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }
}

function convertMethod(node: WTS.Node): ClassMember {
  const nameNode = node.childForFieldName('name')
  const staticNode = node.namedChildren.find(c => c.type === 'static')
  const modifierNode = node.namedChildren.find(c => c.type === 'accessibility_modifier')
  const name = nameNode?.text || ''
  const isConstructor =
    name === 'constructor' || node.type === 'constructor_declaration' || node.type === 'constructor'

  return {
    type: 'Method',
    name,
    kind: isConstructor
      ? 'constructor'
      : node.type.includes('get')
        ? 'getter'
        : node.type.includes('set')
          ? 'setter'
          : 'method',
    visibility:
      (modifierNode?.namedChildren[0]?.text as 'public' | 'private' | 'protected') || 'public',
    isStatic: !!staticNode,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }
}

function convertClass(node: WTS.Node): Class {
  const nameNode = node.childForFieldName('name')
  const superNode = node.childForFieldName('superclass') || node.childForFieldName('super_class')
  const bodyNode = node.childForFieldName('body')

  const members: ClassMember[] = []
  if (bodyNode) {
    for (const child of bodyNode.namedChildren) {
      if (child.type === 'method_definition' || child.type === 'method_signature') {
        members.push(convertMethod(child))
      } else if (
        child.type === 'public_field_definition' ||
        child.type === 'property_definition' ||
        child.type === 'field_definition'
      ) {
        const mName = child.childForFieldName('name')
        const staticNode = child.namedChildren.find(c => c.type === 'static')
        members.push({
          type: 'Property',
          name: mName?.text || child.text,
          kind: 'method',
          visibility: 'public',
          isStatic: !!staticNode,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        })
      }
    }
  }

  return {
    type: 'Class',
    name: nameNode?.text || '',
    superClass: superNode?.text || undefined,
    members,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }
}

function convertLexicalDeclaration(node: WTS.Node): Variable | null {
  const kind =
    node.children.find(c => c.type === 'const' || c.type === 'let' || c.type === 'var')?.text ||
    'const'
  for (const declarator of node.children) {
    if (declarator.type === 'variable_declarator') {
      const nameNode =
        declarator.childForFieldName('name') ||
        declarator.children.find(c => c.type === 'identifier')
      if (nameNode) {
        return {
          type: 'Variable',
          name: nameNode.text,
          kind: kind as 'const' | 'let' | 'var',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        }
      }
    }
  }
  return null
}

function convertVariableDeclaration(node: WTS.Node): Variable | null {
  for (const decl of node.children) {
    if (decl.type === 'variable_declarator') {
      const nameNode =
        decl.childForFieldName('name') || decl.children.find(c => c.type === 'identifier')
      if (nameNode) {
        return {
          type: 'Variable',
          name: nameNode.text,
          kind: 'var',
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        }
      }
    }
  }
  return null
}

function convertImport(node: WTS.Node): Import {
  const sourceNode = node.children.find(c => c.type === 'string' || c.type === 'template_string')
  const specifiers: { type: 'ImportSpecifier'; localName: string; importedName: string }[] = []

  function extractSpecifiers(container: WTS.Node): void {
    for (const c of container.children) {
      if (c.type === 'import_specifier') {
        const name = c.childForFieldName('name')
        const alias = c.childForFieldName('alias')
        const imported = name?.text || c.text
        const local = alias?.text || imported
        specifiers.push({ type: 'ImportSpecifier', localName: local, importedName: imported })
      } else if (c.type === 'identifier') {
        specifiers.push({ type: 'ImportSpecifier', localName: c.text, importedName: c.text })
      } else if (c.type === 'namespace_import') {
        const ns = c.namedChildren.find(n => n.type === 'identifier')
        if (ns) specifiers.push({ type: 'ImportSpecifier', localName: ns.text, importedName: '*' })
      } else if (c.type === 'named_imports' || c.type === 'import_clause') {
        extractSpecifiers(c)
      }
    }
  }

  extractSpecifiers(node)

  return {
    type: 'Import',
    source: sourceNode?.text || node.text,
    specifiers,
  }
}

function convertExport(node: WTS.Node): { type: 'Export'; name: string } | null {
  const sourceNode = node.namedChildren.find(
    c => c.type === 'string' || c.type === 'template_string',
  )
  if (sourceNode) {
    return { type: 'Export', name: sourceNode.text }
  }
  for (const child of node.namedChildren) {
    if (child.type === 'function_declaration' || child.type === 'class_declaration') {
      const nameNode = child.childForFieldName('name')
      return { type: 'Export', name: nameNode?.text || '(unnamed)' }
    }
    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      const decl = child.namedChildren.find(c => c.type === 'variable_declarator')
      const nameNode = decl?.childForFieldName('name')
      return { type: 'Export', name: nameNode?.text || '(anonymous)' }
    }
    if (child.type === 'assignment') {
      const left = child.childForFieldName('left')
      return { type: 'Export', name: left?.text || '(assignment)' }
    }
  }
  return { type: 'Export', name: '(anonymous)' }
}

function convertExportDefault(node: WTS.Node): { type: 'Export'; name: string } | null {
  const valueNode = node.childForFieldName('value')
  if (valueNode) {
    const nameNode = valueNode.childForFieldName('name')
    return { type: 'Export', name: nameNode?.text || 'default' }
  }
  return { type: 'Export', name: 'default' }
}

function convertPythonFunction(node: WTS.Node): FuncDecl {
  const nameNode = node.childForFieldName('name')
  const paramsNode = node.childForFieldName('parameters')
  const returnTypeNode = node.childForFieldName('return_type')
  const asyncNode = node.children.find(c => c.type === 'async')

  const parameters: { name: string }[] = []
  if (paramsNode) {
    for (const param of paramsNode.children) {
      if (param.type === 'identifier') {
        parameters.push({ name: param.text })
      } else if (param.type === 'typed_parameter' || param.type === 'default_parameter') {
        const name = param.childForFieldName('name')?.text || param.text
        parameters.push({ name })
      } else if (param.type === 'list_splat_pattern') {
        const name = param.childForFieldName('name')?.text || param.text
        parameters.push({ name: `*${name}` })
      } else if (param.type === 'keyword_splat_pattern') {
        const name = param.childForFieldName('name')?.text || param.text
        parameters.push({ name: `**${name}` })
      }
    }
  }

  return {
    type: 'Function',
    name: nameNode?.text || null,
    parameters,
    returnType: returnTypeNode?.text || undefined,
    isAsync: !!asyncNode,
    isGenerator: false,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }
}

function convertPythonClass(node: WTS.Node): Class {
  const nameNode = node.childForFieldName('name')
  const superNode = node.childForFieldName('superclasses')
  const bodyNode = node.childForFieldName('body')

  const members: ClassMember[] = []
  if (bodyNode) {
    for (const child of bodyNode.children) {
      if (child.type === 'function_definition' || child.type === 'decorated_definition') {
        const fnNode =
          child.type === 'decorated_definition'
            ? child.children.find(c => c.type === 'function_definition')
            : child
        const mName = fnNode?.childForFieldName('name')?.text || child.text
        const isCtor = mName === '__init__' || mName === '__new__'
        members.push({
          type: 'Method',
          name: mName,
          kind: isCtor ? 'constructor' : 'method',
          visibility: mName.startsWith('__') ? 'private' : 'public',
          isStatic: false,
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
        })
      }
    }
  }

  return {
    type: 'Class',
    name: nameNode?.text || '',
    superClass: superNode?.text || undefined,
    members,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
  }
}

function convertPythonAssignment(node: WTS.Node): Variable | null {
  const leftNode = node.childForFieldName('left')
  if (leftNode && leftNode.type === 'identifier') {
    return {
      type: 'Variable',
      name: leftNode.text,
      kind: 'let',
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    }
  }
  if (leftNode && leftNode.type === 'pattern_list') {
    const first = leftNode.children.find(c => c.type === 'identifier')
    if (first) {
      return {
        type: 'Variable',
        name: first.text,
        kind: 'let',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      }
    }
  }
  return null
}

function convertPythonImport(node: WTS.Node): Import {
  const names: { type: 'ImportSpecifier'; localName: string; importedName: string }[] = []
  const nameNode = node.childForFieldName('name')
  if (nameNode) {
    for (const child of nameNode.children) {
      if (child.type === 'aliased_import') {
        const original = child.childForFieldName('name')?.text || child.text
        const alias = child.childForFieldName('alias')?.text || original
        names.push({ type: 'ImportSpecifier', localName: alias, importedName: original })
      } else if (child.type === 'identifier') {
        names.push({ type: 'ImportSpecifier', localName: child.text, importedName: child.text })
      }
    }
  }
  return {
    type: 'Import',
    source: '',
    specifiers: names,
  }
}

function convertPythonImportFrom(node: WTS.Node): Import {
  const sourceNode = node.childForFieldName('module_name')
  const nameNode = node.childForFieldName('name')
  const names: { type: 'ImportSpecifier'; localName: string; importedName: string }[] = []

  if (nameNode) {
    for (const child of nameNode.children) {
      if (child.type === 'aliased_import') {
        const original = child.childForFieldName('name')?.text || child.text
        const alias = child.childForFieldName('alias')?.text || original
        names.push({ type: 'ImportSpecifier', localName: alias, importedName: original })
      } else if (child.type === 'identifier') {
        names.push({ type: 'ImportSpecifier', localName: child.text, importedName: child.text })
      } else if (child.type === 'wildcard_import') {
        names.push({ type: 'ImportSpecifier', localName: '*', importedName: '*' })
      }
    }
  }

  return {
    type: 'Import',
    source: sourceNode?.text || '',
    specifiers: names,
  }
}

function convertDecoratedDefinition(node: WTS.Node): Statement | null {
  const inner = node.children.find(
    c => c.type === 'function_definition' || c.type === 'class_definition',
  )
  if (inner) return convertNode(inner, 'python')
  return null
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
  return root
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
  }
}
