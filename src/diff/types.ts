export type FileOperationType = 'update' | 'create' | 'delete'

export interface HunkLine {
  kind: 'context' | 'add' | 'delete'
  text: string
}

export interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: HunkLine[]
}

export interface FileChange {
  path: string
  operation: FileOperationType
  hunks: Hunk[]
  content?: string
}

export interface Patch {
  changes: FileChange[]
}