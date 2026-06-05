import * as fs from 'node:fs/promises'
import * as path from 'node:path'

// ── Project type detection ─────────────────────────────────────────────────

export type ProjectType = 'node' | 'python' | 'rust' | 'go' | 'java' | 'cpp' | 'unknown'

export interface ProjectInfo {
  type: ProjectType
  entryPoints: string[]
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  testFiles: string[]
  configFiles: string[]
  srcDirs: string[]
  hasTests: boolean
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null
}

interface PackageJson {
  name?: string
  version?: string
  main?: string
  module?: string
  exports?: string | Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
  type?: string
}

// Common entry point patterns
const ENTRY_PATTERNS: Record<ProjectType, string[]> = {
  node: [
    'src/index.ts',
    'src/main.ts',
    'src/app.ts',
    'src/server.ts',
    'index.ts',
    'app.ts',
    'server.ts',
    'main.ts',
  ],
  python: ['main.py', 'app.py', 'src/main.py', 'src/app.py'],
  rust: ['src/main.rs', 'src/lib.rs'],
  go: ['main.go', 'cmd/main.go'],
  java: ['src/main/java/Main.java'],
  cpp: ['src/main.cpp', 'main.cpp'],
  unknown: [],
}

const TEST_PATTERNS: Record<ProjectType, string[]> = {
  node: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', 'tests/**/*.ts'],
  python: ['test_*.py', '*_test.py', 'tests/**/*.py'],
  rust: ['tests/**/*.rs', 'src/**/*.rs'],
  go: ['*_test.go'],
  java: ['**/*Test.java', '**/*Tests.java'],
  cpp: ['**/*test*.cpp', 'tests/**/*.cpp'],
  unknown: [],
}

const CONFIG_FILES: Record<ProjectType, string[]> = {
  node: [
    'package.json',
    'tsconfig.json',
    'biome.json',
    '.biomerc',
    'jest.config.*',
    'vitest.config.*',
    '.eslintrc*',
    '.prettierrc*',
    '.npmrc',
  ],
  python: [
    'pyproject.toml',
    'setup.py',
    'setup.cfg',
    'requirements.txt',
    'Pipfile',
    'poetry.lock',
    'pytest.ini',
    'pyproject.toml',
  ],
  rust: ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'],
  go: ['go.mod', 'go.sum'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  cpp: ['CMakeLists.txt', 'Makefile', '*.cmake'],
  unknown: [],
}

const SRC_DIRS: Record<ProjectType, string[]> = {
  node: ['src', 'lib', 'app', 'packages'],
  python: ['src', 'lib', 'app'],
  rust: ['src'],
  go: ['cmd', 'internal', 'pkg'],
  java: ['src/main/java', 'src'],
  cpp: ['src', 'lib', 'include'],
  unknown: [],
}

// ── Detection functions ───────────────────────────────────────────────────

/** Detect project type from root directory */
async function detectProjectType(cwd: string): Promise<ProjectType> {
  const files = await fs.readdir(cwd, { withFileTypes: true })
  const fileNames = files.map(f => f.name.toLowerCase())

  // Priority order matters
  if (fileNames.includes('cargo.toml')) return 'rust'
  if (fileNames.includes('go.mod')) return 'go'
  if (fileNames.includes('pom.xml') || fileNames.includes('build.gradle')) return 'java'
  if (fileNames.includes('package.json')) return 'node'
  if (
    fileNames.includes('pyproject.toml') ||
    fileNames.includes('setup.py') ||
    fileNames.includes('requirements.txt')
  )
    return 'python'
  if (fileNames.includes('cmakelists.txt')) return 'cpp'

  return 'unknown'
}

/** Find entry points for the project */
async function findEntryPoints(cwd: string, type: ProjectType): Promise<string[]> {
  if (type === 'unknown') return []

  const entryPoints: string[] = []
  const patterns = ENTRY_PATTERNS[type]

  for (const pattern of patterns) {
    const fullPath = path.join(cwd, pattern)
    try {
      const stat = await fs.stat(fullPath)
      if (stat.isFile()) {
        entryPoints.push(pattern)
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  // For Node.js, also check package.json main/module
  if (type === 'node') {
    try {
      const pkgPath = path.join(cwd, 'package.json')
      const content = await fs.readFile(pkgPath, 'utf-8')
      const pkg: PackageJson = JSON.parse(content)
      if (pkg.main && !entryPoints.includes(pkg.main)) {
        entryPoints.push(pkg.main)
      }
      if (pkg.module && !entryPoints.includes(pkg.module)) {
        entryPoints.push(pkg.module)
      }
    } catch {
      // No package.json
    }
  }

  return entryPoints
}

/** Find test files */
async function findTestFiles(cwd: string, type: ProjectType): Promise<string[]> {
  if (type === 'unknown') return []

  const testFiles: string[] = []
  const patterns = TEST_PATTERNS[type]

  // Simple glob simulation - just check common locations
  const dirs =
    type === 'node'
      ? ['src', 'tests', '__tests__', '']
      : type === 'python'
        ? ['tests', '']
        : type === 'rust'
          ? ['tests', 'src']
          : ['']

  for (const dir of dirs) {
    const searchDir = dir ? path.join(cwd, dir) : cwd
    try {
      const files = await fs.readdir(searchDir, { withFileTypes: true })
      for (const file of files) {
        if (file.isFile()) {
          const name = file.name.toLowerCase()
          if (name.includes('test') || name.includes('spec')) {
            const relPath = dir ? `${dir}/${file.name}` : file.name
            testFiles.push(relPath)
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return testFiles.slice(0, 10) // Limit to 10
}

/** Find config files */
async function findConfigFiles(cwd: string, type: ProjectType): Promise<string[]> {
  const configs: string[] = []
  const patterns = CONFIG_FILES[type] || []

  for (const pattern of patterns) {
    const fullPath = path.join(cwd, pattern)
    try {
      const stat = await fs.stat(fullPath)
      if (stat.isFile()) {
        configs.push(pattern)
      }
    } catch {
      // File doesn't exist
    }
  }

  return configs
}

/** Find source directories */
async function findSrcDirs(cwd: string, type: ProjectType): Promise<string[]> {
  const srcDirs: string[] = []
  const patterns = SRC_DIRS[type] || []

  for (const pattern of patterns) {
    const fullPath = path.join(cwd, pattern)
    try {
      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) {
        srcDirs.push(pattern)
      }
    } catch {
      // Directory doesn't exist
    }
  }

  return srcDirs
}

/** Detect package manager */
async function detectPackageManager(cwd: string): Promise<ProjectInfo['packageManager']> {
  const files = await fs.readdir(cwd, { withFileTypes: true })
  const fileNames = files.map(f => f.name)

  if (fileNames.includes('pnpm-lock.yaml')) return 'pnpm'
  if (fileNames.includes('yarn.lock')) return 'yarn'
  if (fileNames.includes('bun.lockb')) return 'bun'
  if (fileNames.includes('package-lock.json')) return 'npm'

  return null
}

/** Load dependencies from package.json */
async function loadDependencies(
  cwd: string,
): Promise<{ deps: Record<string, string>; devDeps: Record<string, string> }> {
  try {
    const pkgPath = path.join(cwd, 'package.json')
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg: PackageJson = JSON.parse(content)
    return {
      deps: pkg.dependencies || {},
      devDeps: pkg.devDependencies || {},
    }
  } catch {
    return { deps: {}, devDeps: {} }
  }
}

// ── Main discovery function ───────────────────────────────────────────────

// Cache for project info
const projectCache = new Map<string, { info: ProjectInfo; timestamp: number }>()
const CACHE_TTL = 60_000 // 1 minute

/**
 * Discover project information for a given directory.
 * Results are cached for 1 minute to avoid repeated disk I/O.
 */
export async function discoverProject(cwd: string): Promise<ProjectInfo> {
  // Check cache first
  const cached = projectCache.get(cwd)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.info
  }

  const type = await detectProjectType(cwd)
  const [entryPoints, testFiles, configFiles, srcDirs, packageManager, deps] = await Promise.all([
    findEntryPoints(cwd, type),
    findTestFiles(cwd, type),
    findConfigFiles(cwd, type),
    findSrcDirs(cwd, type),
    detectPackageManager(cwd),
    type === 'node' ? loadDependencies(cwd) : Promise.resolve({ deps: {}, devDeps: {} }),
  ])

  const info: ProjectInfo = {
    type,
    entryPoints,
    dependencies: deps.deps,
    devDependencies: deps.devDeps,
    testFiles,
    configFiles,
    srcDirs,
    hasTests: testFiles.length > 0,
    packageManager,
  }

  // Cache the result
  projectCache.set(cwd, { info, timestamp: Date.now() })

  return info
}

/** Clear project cache */
export function clearProjectCache(): void {
  projectCache.clear()
}

/** Invalidate cache for a specific directory */
export function invalidateProjectCache(cwd: string): void {
  projectCache.delete(cwd)
}

/**
 * Format project info as a string for inclusion in prompts.
 */
export function formatProjectContext(info: ProjectInfo): string {
  const lines: string[] = ['## Project Context']

  if (info.type === 'unknown') {
    lines.push('- Project type: Unknown')
    return lines.join('\n')
  }

  lines.push(`- Project type: ${info.type}`)
  lines.push(`- Package manager: ${info.packageManager || 'unknown'}`)

  if (info.entryPoints.length > 0) {
    lines.push(`- Entry point(s): ${info.entryPoints.join(', ')}`)
  }

  if (info.srcDirs.length > 0) {
    lines.push(`- Source directories: ${info.srcDirs.join(', ')}`)
  }

  if (info.configFiles.length > 0) {
    lines.push(`- Config files: ${info.configFiles.join(', ')}`)
  }

  if (info.hasTests) {
    const testCount = info.testFiles.length
    lines.push(`- Test files: ${testCount} found`)
  }

  // Show main dependencies
  const mainDeps = Object.keys(info.dependencies).slice(0, 10)
  if (mainDeps.length > 0) {
    lines.push(
      `- Dependencies: ${mainDeps.join(', ')}${Object.keys(info.dependencies).length > 10 ? '...' : ''}`,
    )
  }

  return lines.join('\n')
}
