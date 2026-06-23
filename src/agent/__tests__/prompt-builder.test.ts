import { describe, expect, it } from 'vitest'
import type { Config } from '../../config/index.js'
import type { ToolDefinition } from '../../tools/types.js'
import type { BuildContext } from '../prompt-builder-types.js'
import { AskPromptStrategy } from '../strategies/ask.js'
import { CodePromptStrategy } from '../strategies/code.js'
import { getStrategyForMode } from '../strategies/index.js'
import { LoopPromptStrategy } from '../strategies/loop.js'
import { PlanPromptStrategy } from '../strategies/plan.js'
import { ReviewPromptStrategy } from '../strategies/review.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const minimalConfig: Config = {
  mode: 'code',
  apiKey: 'test-key',
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  contextWindow: 200_000,
  cwd: '/test/project',
  autoApprove: false,
}

const mockContext: BuildContext = {
  envSection: 'Environment:\n- Platform: test\n- Shell: bash\n',
  sharedRules: '\nRULES:\n1. Shared rule\n',
  projectSection: '\n## Project Context\n\nTest project\n',
  memorySection: '\n## Long-term Memory\n\nTest memory\n',
  skillsSection: '\n## Skills\n\nTest skill\n',
}

function mockDefinition(name: string): ToolDefinition {
  return { name, description: `The ${name} tool`, parameters: {} }
}

// ── 5.2: Factory tests ──────────────────────────────────────────────────────

describe('getStrategyForMode()', () => {
  it('returns CodePromptStrategy for code mode', () => {
    expect(getStrategyForMode('code')).toBeInstanceOf(CodePromptStrategy)
  })

  it('returns PlanPromptStrategy for plan mode', () => {
    expect(getStrategyForMode('plan')).toBeInstanceOf(PlanPromptStrategy)
  })

  it('returns ReviewPromptStrategy for review mode', () => {
    expect(getStrategyForMode('review')).toBeInstanceOf(ReviewPromptStrategy)
  })

  it('returns AskPromptStrategy for ask mode', () => {
    expect(getStrategyForMode('ask')).toBeInstanceOf(AskPromptStrategy)
  })

  it('returns LoopPromptStrategy for loop mode', () => {
    expect(getStrategyForMode('loop')).toBeInstanceOf(LoopPromptStrategy)
  })

  it('throws for unknown mode', () => {
    expect(() => getStrategyForMode('unknown')).toThrow('Unknown mode')
  })

  it('returns a singleton (same instance for repeated calls)', () => {
    const a = getStrategyForMode('code')
    const b = getStrategyForMode('code')
    expect(a).toBe(b)
  })
})

// ── 5.1: Strategy unit tests ─────────────────────────────────────────────────

describe('CodePromptStrategy', () => {
  const strategy = new CodePromptStrategy()

  it('has mode === "code"', () => {
    expect(strategy.mode).toBe('code')
  })

  it('useSharedRules() returns true', () => {
    expect(strategy.useSharedRules()).toBe(true)
  })

  it('getInstructions() returns code persona with rules', () => {
    const result = strategy.getInstructions(minimalConfig)
    expect(result).toContain('You are a coding agent optimized for per-call pricing')
    expect(result).toContain('RULES (code-specific)')
    expect(result).toContain('COST OPTIMIZATION')
    expect(result).toContain('CONTEXT OPTIMIZATION')
    expect(result).not.toContain('Available tools')
  })

  it('getToolList() returns full tool list without definitions', () => {
    const result = strategy.getToolList('code')
    expect(result).toContain('Available tools')
    expect(result).toContain('`read`')
    expect(result).toContain('`edit`')
    expect(result).toContain('`bash`')
    expect(result).toContain('`git`')
    expect(result).toContain('`search`')
    expect(result).toContain('`ast_query`')
    expect(result).toContain('`ast_edit`')
    // Should NOT have plan/review-specific tools
    expect(result).not.toContain('write_plan')
  })

  it('getToolList() uses dynamic tree when definitions provided', () => {
    const defs = [mockDefinition('custom_tool'), mockDefinition('another_tool')]
    const result = strategy.getToolList('code', defs)
    expect(result).toContain('Available tools')
    expect(result).toContain('Direct access')
    expect(result).toContain('custom_tool')
    expect(result).toContain('another_tool')
  })

  it('getMethodology() contains Development Methodology', () => {
    const result = strategy.getMethodology()
    expect(result).toContain('Development Methodology')
    expect(result).toContain('Systematic Debugging')
    expect(result).toContain('Verification Before Completion')
  })

  it('build() produces full prompt with shared rules and env', () => {
    const result = strategy.build(minimalConfig, mockContext)
    expect(result).toContain('You are a coding agent')
    expect(result).toContain('Environment:')
    expect(result).toContain('RULES:\n1. Shared rule')
    expect(result).toContain('## Development Methodology')
    expect(result).toContain('## Project Context')
    expect(result).toContain('## Long-term Memory')
    expect(result).toContain('## Skills')
    // shared rules comes after envSection
    const envIdx = result.indexOf('Environment:')
    const sharedIdx = result.indexOf('RULES:\n1. Shared rule')
    expect(sharedIdx).toBeGreaterThan(envIdx)
  })
})

describe('PlanPromptStrategy', () => {
  const strategy = new PlanPromptStrategy()

  it('has mode === "plan"', () => {
    expect(strategy.mode).toBe('plan')
  })

  it('useSharedRules() returns false', () => {
    expect(strategy.useSharedRules()).toBe(false)
  })

  it('getInstructions() contains planning agent persona', () => {
    const result = strategy.getInstructions(minimalConfig)
    expect(result).toContain('You are a planning agent')
    expect(result).toContain('RULES (plan-specific)')
    expect(result).toContain('OUTPUT FORMAT')
    expect(result).toContain('Switch to code mode')
    expect(result).toContain('`write_plan`')
  })

  it('getToolList() returns plan-specific tools without definitions', () => {
    const result = strategy.getToolList('plan')
    expect(result).toContain('Available tools (read-only investigation + write_plan)')
    expect(result).toContain('`write_plan`')
    expect(result).toContain('Save plan/todo markdown')
    expect(result).not.toContain('`edit`')
  })

  it('getToolList() uses dynamic tree when definitions provided', () => {
    const defs = [mockDefinition('plan_tool')]
    const result = strategy.getToolList('plan', defs)
    expect(result).toContain('Available tools (read-only investigation + write_plan)')
    expect(result).toContain('plan_tool')
  })

  it('getMethodology() contains Design-First Planning', () => {
    const result = strategy.getMethodology()
    expect(result).toContain('Design-First Planning')
    expect(result).toContain('Ask clarifying questions')
    expect(result).toContain('Save the plan via')
  })

  it('build() does NOT include shared rules', () => {
    const result = strategy.build(minimalConfig, mockContext)
    expect(result).toContain('You are a planning agent')
    expect(result).toContain('Environment:')
    expect(result).not.toContain('1. Shared rule')
    expect(result).toContain('## Design-First Planning')
    expect(result).toContain('## Project Context')
    expect(result).toContain('## Long-term Memory')
    expect(result).toContain('## Skills')
  })
})

describe('ReviewPromptStrategy', () => {
  const strategy = new ReviewPromptStrategy()

  it('has mode === "review"', () => {
    expect(strategy.mode).toBe('review')
  })

  it('useSharedRules() returns false', () => {
    expect(strategy.useSharedRules()).toBe(false)
  })

  it('getInstructions() contains review agent persona', () => {
    const result = strategy.getInstructions(minimalConfig)
    expect(result).toContain('You are a code review agent')
    expect(result).toContain('RULES (review-specific)')
    expect(result).toContain('Switch to code mode to address these findings')
    expect(result).toContain('`git diff`')
  })

  it('getToolList() returns review-specific tools', () => {
    const result = strategy.getToolList('review')
    expect(result).toContain('Available tools (read-only investigation + bash/git + write_plan)')
    expect(result).toContain('`git diff`')
    expect(result).toContain('`write_plan`')
    expect(result).not.toContain('`edit`')
  })

  it('getMethodology() contains Review Methodology', () => {
    const result = strategy.getMethodology()
    expect(result).toContain('Review Methodology')
    expect(result).toContain('Review Checklist')
    expect(result).toContain('🔴 Critical')
    expect(result).toContain('🟡 Warning')
    expect(result).toContain('🔵 Suggestion')
  })

  it('build() does NOT include shared rules', () => {
    const result = strategy.build(minimalConfig, mockContext)
    expect(result).not.toContain('1. Shared rule')
    expect(result).toContain('## Review Methodology')
  })
})

describe('AskPromptStrategy', () => {
  const strategy = new AskPromptStrategy()

  it('has mode === "ask"', () => {
    expect(strategy.mode).toBe('ask')
  })

  it('useSharedRules() returns false', () => {
    expect(strategy.useSharedRules()).toBe(false)
  })

  it('getInstructions() contains Q&A assistant persona', () => {
    const result = strategy.getInstructions(minimalConfig)
    expect(result).toContain('You are a Q&A assistant')
    expect(result).toContain('RULES (ask-specific)')
    expect(result).toContain('suggest switching to code mode')
  })

  it('getToolList() returns only fetch and search', () => {
    const result = strategy.getToolList('ask')
    expect(result).toContain('`fetch`')
    expect(result).toContain('`search`')
    expect(result).not.toContain('`read`')
    expect(result).not.toContain('`bash`')
    expect(result).not.toContain('`edit`')
    expect(result).not.toContain('`write_plan`')
  })

  it('getToolList() uses dynamic tree with ask-specific header when definitions provided', () => {
    const defs = [mockDefinition('web_tool')]
    const result = strategy.getToolList('ask', defs)
    expect(result).toContain('Available tools')
    expect(result).not.toContain('Direct access') // ask mode doesn't have this note
    expect(result).toContain('web_tool')
  })

  it('getMethodology() returns empty string', () => {
    expect(strategy.getMethodology()).toBe('')
  })

  it('build() does NOT include shared rules or methodology', () => {
    const result = strategy.build(minimalConfig, mockContext)
    expect(result).toContain('You are a Q&A assistant')
    expect(result).toContain('Environment:')
    expect(result).not.toContain('1. Shared rule')
    expect(result).not.toContain('Methodology')
    expect(result).toContain('## Project Context')
    expect(result).toContain('## Long-term Memory')
    expect(result).toContain('## Skills')
  })
})

describe('LoopPromptStrategy', () => {
  const strategy = new LoopPromptStrategy()

  it('has mode === "loop"', () => {
    expect(strategy.mode).toBe('loop')
  })

  it('useSharedRules() returns false', () => {
    expect(strategy.useSharedRules()).toBe(false)
  })

  it('getInstructions() contains LOOP mode persona', () => {
    const result = strategy.getInstructions(minimalConfig)
    expect(result).toContain('operating in LOOP mode')
    expect(result).toContain('RULES (loop-specific)')
    expect(result).toContain('LOOP BEHAVIOR')
    expect(result).toContain('14. You can use /stop')
  })

  it('getToolList() returns same full tool list as code mode', () => {
    const result = strategy.getToolList('loop')
    expect(result).toContain('`read`')
    expect(result).toContain('`edit`')
    expect(result).toContain('`bash`')
    expect(result).toContain('`save_memory`')
    expect(result).toContain('`install_skill`')
  })

  it('getMethodology() contains same Development Methodology as code mode', () => {
    const result = strategy.getMethodology()
    expect(result).toContain('Development Methodology')
    expect(result).toContain('Systematic Debugging')
  })

  it('build() does NOT include shared rules', () => {
    const result = strategy.build(minimalConfig, mockContext)
    expect(result).not.toContain('1. Shared rule')
    expect(result).toContain('## Development Methodology')
  })
})

// ── 5.3: Integration test — build() with definitions ────────────────────────

describe('build() integration with tool definitions', () => {
  const definitions: ToolDefinition[] = [
    { name: 'read', description: 'Read files', parameters: { paths: { type: 'array' } } },
    { name: 'edit', description: 'Edit files', parameters: { content: { type: 'string' } } },
    { name: 'custom_debug', description: 'A custom tool', parameters: {} },
  ]

  it('CodePromptStrategy getToolList() uses definitions for dynamic tree', () => {
    const strategy = new CodePromptStrategy()
    const result = strategy.getToolList('code', definitions)
    expect(result).toContain('Direct access')
    expect(result).toContain('custom_debug')
  })

  it('PlanPromptStrategy includes definitions with plan-specific header', () => {
    const strategy = new PlanPromptStrategy()
    const result = strategy.getToolList('plan', definitions)
    expect(result).toContain('Available tools (read-only investigation + write_plan)')
    expect(result).toContain('custom_debug')
  })

  it('ReviewPromptStrategy includes definitions with review-specific header', () => {
    const strategy = new ReviewPromptStrategy()
    const result = strategy.getToolList('review', definitions)
    expect(result).toContain('Available tools (read-only investigation + bash/git + write_plan)')
    expect(result).toContain('custom_debug')
  })

  it('all strategies produce a non-empty string from build()', () => {
    const strategies = [
      new CodePromptStrategy(),
      new PlanPromptStrategy(),
      new ReviewPromptStrategy(),
      new AskPromptStrategy(),
      new LoopPromptStrategy(),
    ]
    for (const s of strategies) {
      const result = s.build(minimalConfig, mockContext)
      expect(result.length).toBeGreaterThan(0)
      // Every strategy should include environment section
      expect(result).toContain('Environment:')
      expect(result).toContain(mockContext.envSection)
    }
  })

  it('build() output order follows template: instructions → env → [sharedRules] → methodology → project → memory → skills', () => {
    const codeStrategy = new CodePromptStrategy()
    const codeResult = codeStrategy.build(minimalConfig, mockContext)
    const order = [
      codeResult.indexOf('You are a coding agent'),
      codeResult.indexOf('Environment:'),
      codeResult.indexOf('1. Shared rule'),
      codeResult.indexOf('## Development Methodology'),
      codeResult.indexOf('## Project Context'),
      codeResult.indexOf('## Long-term Memory'),
      codeResult.indexOf('## Skills'),
    ]
    // All indices should be in ascending order
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1])
    }

    // For standalone mode (plan), shared rules should NOT appear
    const planStrategy = new PlanPromptStrategy()
    const planResult = planStrategy.build(minimalConfig, mockContext)
    expect(planResult).not.toContain('1. Shared rule')
  })
})
