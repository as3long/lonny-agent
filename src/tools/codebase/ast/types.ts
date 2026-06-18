export interface Module {
  type: 'Module'
  filePath: string
  language: 'typescript' | 'javascript' | 'python'
  imports: Import[]
  body: Statement[]
  exports: string[]
}

export interface Import {
  type: 'Import'
  source: string
  specifiers: ImportSpecifier[]
  isTypeOnly?: boolean
}

export interface ImportSpecifier {
  type: 'ImportSpecifier'
  localName: string
  importedName: string
}

export interface FuncDecl {
  type: 'Function'
  name: string | null
  parameters: Parameter[]
  returnType?: string
  isAsync: boolean
  isGenerator: boolean
  startLine: number
  endLine: number
}

export interface Parameter {
  name: string
}

export interface Class {
  type: 'Class'
  name: string
  superClass?: string
  members: ClassMember[]
  startLine: number
  endLine: number
}

export interface Variable {
  type: 'Variable'
  name: string
  kind: 'const' | 'let' | 'var'
  startLine: number
  endLine: number
}

export interface ClassMember {
  type: 'Property' | 'Method'
  name: string
  kind: 'constructor' | 'method' | 'getter' | 'setter'
  visibility: 'public' | 'private' | 'protected'
  isStatic: boolean
  startLine: number
  endLine: number
}

export interface StructureOverview {
  filePath: string
  language: string
  imports: { source: string; names: string[] }[]
  exports: string[]
  functions: { name: string | null; line: number }[]
  classes: { name: string; line: number; methods: string[] }[]
  variables: { name: string; line: number }[]
}

export interface AstEdit {
  type: 'insert' | 'replace' | 'delete'
  startOffset: number
  endOffset?: number
  text?: string
}

export interface TextEditResult {
  success: boolean
  source: string
  editsApplied: number
  error?: string
}

export type Statement = FuncDecl | Class | Variable | Import | Export

export interface Export {
  type: 'Export'
  name: string
}
