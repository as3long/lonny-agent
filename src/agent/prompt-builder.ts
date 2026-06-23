import * as os from 'node:os'
import type { Config } from '../config/index.js'
import type { ToolDefinition } from '../tools/types.js'
import { formatMemoryForPrompt, loadMemory } from './memory.js'
import { discoverProject, formatProjectContext } from './project.js'
import type { BuildContext } from './prompt-builder-types.js'
import { formatSkillsForPrompt, loadSkills } from './skills.js'
import { getStrategyForMode } from './strategies/index.js'

/**
 * Build the system prompt for the current configuration.
 * Extracted from session.ts to keep module size manageable (<500 LoC target).
 *
 * Uses Strategy Pattern + Template Method Pattern internally
 * (see src/agent/strategies/ for each mode's strategy).
 *
 * @param config - Current configuration
 * @param definitions - Optional tool definitions for dynamic tree generation.
 *   When provided, replaces the hardcoded tool lists with a hierarchical tree.
 */
export async function buildSystemPrompt(
  config: Config,
  definitions?: ToolDefinition[],
): Promise<string> {
  const platform = os.platform()
  const release = os.release()
  const shell = process.env.SHELL || process.env.ComSpec || 'unknown'
  const arch = os.arch()
  const cwd = config.cwd
  const isWindows = platform === 'win32'

  // ── Load skills ────────────────────────────────────────────────────────
  const skills = loadSkills(cwd)
  const skillsSection = formatSkillsForPrompt(skills)

  // ── Load long-term memory (persistent) ─────────────────────────────────
  const memories = loadMemory(cwd)
  const memorySection = formatMemoryForPrompt(memories)

  // ── Load project context ─────────────────────────────────────────────────
  const projectInfo = await discoverProject(cwd)
  const projectSection = formatProjectContext(projectInfo)

  // ── Shared sections (built once, stable across modes) ────────────────────
  const envSection = `Environment:
- Platform: ${platform} ${release} (${arch})
- Shell: ${shell}
- Working directory: ${cwd}
- OS: ${isWindows ? 'Windows' : 'Linux/macOS'}
  - Available shell commands: ${isWindows ? 'PowerShell (cmd is also available but PowerShell is preferred)' : 'bash'}
${isWindows ? '  ⚠️  THIS IS WINDOWS. Do NOT use Unix/Linux paths like `/workspace/...` or `/home/...`. The working directory is a Windows path (e.g. `C:\\Users\\...`).' : ''}
${isWindows ? '  ⚠️  Do NOT use Unix commands: `find`, `cat`, `ls -la`, `which`, `cp`, `mv`, `rm`, `touch`, `chmod`, `mkdir`, `grep`, `head`, `tail`. They will ALL fail.' : ''}
${isWindows ? '  - Use `type` instead of `cat`, `dir` instead of `ls`, `where` instead of `which`, `Select-Object -First N` instead of `head -N`' : ''}
${isWindows ? '  - Use `;` (semicolon) instead of `&&` to chain commands' : ''}
${isWindows ? '  - ⚠️  `Select-String` exits with code 1 when no match is found (e.g. `Select-String -Pattern "FAIL"` returns code 1 if no line contains FAIL). This is NORMAL — it does NOT mean the command failed. Append `; $LASTEXITCODE = 0` to suppress this.' : ''}
${isWindows ? '  - ⚠️  PowerShell syntax: use `${var}.member` instead of `$var.member`. In PowerShell, `$var:member` is interpreted as a drive-qualified variable (like `$env:Path`). Always wrap the variable name in braces: `${lines}.Length` NOT `$lines.Length`, `${bytes}[0]` NOT `$bytes[0]`.' : ''}
${isWindows ? '  - ⚠️  Do NOT use `Remove-Item -Recurse -Force` or `rm -rf` — these are blocked by security. For cleanup, remove specific files with `del <path>` or use the `edit` tool.' : ''}
${isWindows ? '  - PowerShell code snippet template (use these patterns instead of guessing):' : ''}
${isWindows ? '    Get-Content file.txt                         # cat' : ''}
${isWindows ? '    Get-Content file.txt -Head 10                # head -10' : ''}
${isWindows ? '    (Get-Content file.txt) -join "\`n"            # read whole file as single string' : ''}
${isWindows ? '    Get-ChildItem -Recurse -Filter "*.ts"        # find .' : ''}
${isWindows ? '    Get-ChildItem src -Recurse -Include "*.ts","*.js"  # find with multiple patterns' : ''}
${isWindows ? '    Select-String -Pattern "TODO" -Path "src/**/*.ts"  # grep -r' : ''}
${isWindows ? '    Select-String -Pattern "TODO" -Path "*.ts"   # grep in current dir only' : ''}
${isWindows ? '    # Append `; $LASTEXITCODE = 0` when no match is expected' : ''}
${isWindows ? '    Get-ChildItem                               # ls' : ''}
${isWindows ? '    Get-ChildItem -Directory                    # ls -d */' : ''}
${isWindows ? '    Get-ChildItem -Name                         # ls -1' : ''}
${isWindows ? '    ${lines}.Length                              # NOT $lines.Length' : ''}
${isWindows ? '    ${bytes}[0]                                  # NOT $bytes[0]' : ''}
${isWindows ? '    ${line}.Trim()                               # NOT $line.Trim()' : ''}
${isWindows ? '    ${text}.Replace("old","new")                 # string replace' : ''}
${isWindows ? '    $env:USERNAME                                # env vars (this syntax is OK)' : ''}
${isWindows ? '    npm test                                     # run npm scripts (works as-is)' : ''}
${isWindows ? '    node script.js                               # run node (works as-is)' : ''}
${isWindows ? '    npx vitest run                               # run vitest (works as-is)' : ''}
${isWindows ? '    cmd /c "command"                             # fallback: run via cmd.exe' : ''}
${isWindows ? '    command1; command2; command3                 # use ; not &&' : ''}
${isWindows ? '  - ⚠️  Pre-commit hooks (Husky/lint-staged) often fail on Windows due to CRLF warnings. Use `git commit --no-verify` to bypass them. The `git` tool auto-adds `--no-verify` on Windows.' : ''}`

  const sharedRules = `
RULES:
1. Read first: Use read/grep/glob tools to gather all context you need before making any edits.
2. Be thorough: Explore the relevant parts of the codebase.
  3. AST tools (\`ast_query\`, \`ast_edit\`) are available via the \`tool()\` gateway. Use \`ast_query\` to inspect code structure (functions, classes, imports) before editing. Use \`ast_edit\` for structure-aware edits that preserve formatting.
4. **For JavaScript/TypeScript files, prefer AST tools over raw text tools**: Use \`ast_query\` (not \`read\`) to understand file structure — it returns structured function/class/import/export data with exact line numbers. Use \`ast_edit\` (not \`edit\`) to replace entire functions, classes, or variables — it avoids string-matching issues and preserves formatting. Reserve \`edit\` for small surgical changes to function bodies or single-line fixes.
5. COST OPTIMIZATION (CRITICAL): Each API call costs money. You MUST maximize work per call. Use \`read(paths: [...])\` to read multiple files at once. Use \`edit({ content: "..." })\` with multiple \`\`\`edit blocks to edit multiple files at once.
6. There is NO "write" tool. To modify files, use the \`edit\` tool (listed above). Calling \`write\` will fail with "Unknown tool".
`

  const memoryPromptSection = memorySection ? `\n## Long-term Memory\n\n${memorySection}` : ''

  const context: BuildContext = {
    envSection,
    sharedRules,
    projectSection,
    memorySection: memoryPromptSection,
    skillsSection,
  }

  // ── Delegate to strategy ─────────────────────────────────────────────────
  const strategy = getStrategyForMode(config.mode)
  return strategy.build(config, context, definitions)
}
