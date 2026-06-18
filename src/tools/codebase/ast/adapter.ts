import type {
  AstEdit,
  Class,
  FuncDecl,
  Module,
  Reference,
  StructureOverview,
  TextEditResult,
  Variable,
} from './types.js'

export type { AstEdit, TextEditResult }

export function detectLanguage(filePath: string): 'typescript' | 'javascript' | 'python' {
  const ext = filePath.toLowerCase().split('.').pop() || ''
  if (ext === 'ts' || ext === 'tsx' || ext === 'mts' || ext === 'cts') return 'typescript'
  if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript'
  if (ext === 'py') return 'python'
  throw new Error(`Unsupported file type for AST: ${filePath}`)
}

export interface AstAdapter {
  init(): Promise<void>
  supportedLanguages(): string[]
  parse(source: string, filePath: string): Promise<Module>
  findFunctions(node: Module, query?: { name?: string }): FuncDecl[]
  findClasses(node: Module, query?: { name?: string }): Class[]
  findVariables(node: Module, query?: { name?: string }): Variable[]
  findReferences(source: string, filePath: string, name: string): Promise<Reference[]>
  getStructure(node: Module): StructureOverview
  applyEdits(source: string, filePath: string, edits: AstEdit[]): Promise<TextEditResult>
  replaceNode(
    source: string,
    filePath: string,
    targetLine: number,
    newCode: string,
  ): Promise<TextEditResult>
  insertMethodIntoClass(
    source: string,
    filePath: string,
    className: string,
    methodCode: string,
  ): Promise<TextEditResult>
}
