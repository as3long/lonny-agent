export type DiffLineType = 'delete' | 'insert' | 'equal'

export interface DiffLine {
  type: DiffLineType
  content: string
}

export interface MatchPos {
  index: number
  length: number
}

export interface SingleEdit {
  file_path: string
  old_string: string
  new_string: string
}

export type Edit = SingleEdit
