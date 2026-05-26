import * as fs from 'node:fs'
import * as path from 'node:path'

export interface FileState {
  lastReadTime: number
  modTime: number
}

export class FileReadTracker {
  private readFiles: Map<string, FileState> = new Map()

  markRead(filePath: string): void {
    const resolved = path.resolve(filePath)
    try {
      const stat = fs.statSync(resolved)
      this.readFiles.set(resolved, {
        lastReadTime: Date.now(),
        modTime: stat.mtimeMs,
      })
    } catch {
      this.readFiles.set(resolved, {
        lastReadTime: Date.now(),
        modTime: 0,
      })
    }
  }

  checkModified(resolvedPath: string): string | null {
    const state = this.readFiles.get(resolvedPath)
    if (!state) {
      return `File "${resolvedPath}" was not read in this session. Read it first before editing.`
    }
    try {
      const stat = fs.statSync(resolvedPath)
      if (stat.mtimeMs > state.modTime) {
        return `File "${resolvedPath}" was modified externally since last read. Re-read it before editing.`
      }
    } catch {
      return `File "${resolvedPath}" no longer exists.`
    }
    return null
  }
}