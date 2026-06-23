import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatActivePlanForPrompt, scanPlans } from '../plans.js'

function createPlanFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content, 'utf-8')
  return p
}

describe('scanPlans', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync('plans-test-')
    fs.mkdirSync(path.join(tmpDir, '.lonny'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when no .lonny directory exists', () => {
    const emptyDir = fs.mkdtempSync('no-plans-')
    const plans = scanPlans(emptyDir)
    expect(plans).toEqual([])
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })

  it('returns empty array when no plan files have todo lists', () => {
    fs.writeFileSync(path.join(tmpDir, '.lonny', 'readme.md'), '# Notes\nNo todo here', 'utf-8')
    const plans = scanPlans(tmpDir)
    expect(plans).toEqual([])
  })

  it('detects a plan file with ## Todo List section', () => {
    createPlanFile(
      tmpDir,
      '.lonny/backend-api.md',
      `## Plan
Implement the backend API for the user module.

## Todo List
- [ ] Create User model
- [ ] Implement routes
- [ ] Write tests
`,
    )
    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(1)
    expect(plans[0].name).toBe('backend-api')
    expect(plans[0].totalItems).toBe(3)
    expect(plans[0].pendingItems).toBe(3)
    expect(plans[0].doneItems).toBe(0)
    expect(plans[0].hasPending).toBe(true)
    expect(plans[0].description).toContain('Implement the backend API')
  })

  it('correctly counts completed items', () => {
    createPlanFile(
      tmpDir,
      '.lonny/test-plan.md',
      `## Plan
Test plan

## Todo List
- [x] Set up project
- [x] Configure CI
- [ ] Write unit tests
- [ ] Integration tests
`,
    )
    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(1)
    expect(plans[0].totalItems).toBe(4)
    expect(plans[0].doneItems).toBe(2)
    expect(plans[0].pendingItems).toBe(2)
    expect(plans[0].hasPending).toBe(true)
  })

  it('marks plan as no pending when all items done', () => {
    createPlanFile(
      tmpDir,
      '.lonny/done-plan.md',
      `## Plan
All done

## Todo List
- [x] Task A
- [x] Task B
`,
    )
    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(1)
    expect(plans[0].pendingItems).toBe(0)
    expect(plans[0].hasPending).toBe(false)
  })

  it('handles ## Todo (without " List") as well', () => {
    createPlanFile(
      tmpDir,
      '.lonny/plan.md',
      `## Plan
Some plan

## Todo
- [ ] Item 1
- [x] Item 2
`,
    )
    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(1)
    expect(plans[0].totalItems).toBe(2)
    expect(plans[0].pendingItems).toBe(1)
  })

  it('sorts plans by mtime descending (most recent first)', async () => {
    createPlanFile(tmpDir, '.lonny/old-plan.md', `## Plan\nOld\n## Todo\n- [ ] item`)
    await new Promise(r => setTimeout(r, 50))
    createPlanFile(tmpDir, '.lonny/new-plan.md', `## Plan\nNew\n## Todo\n- [ ] item`)

    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(2)
    expect(plans[0].name).toBe('new-plan')
    expect(plans[1].name).toBe('old-plan')
  })

  it('ignores non-markdown files', () => {
    fs.writeFileSync(path.join(tmpDir, '.lonny', 'notes.txt'), '## Todo\n- [ ] item', 'utf-8')
    const plans = scanPlans(tmpDir)
    expect(plans.length).toBe(0)
  })
})

describe('formatActivePlanForPrompt', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync('plans-format-')
    fs.mkdirSync(path.join(tmpDir, '.lonny'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty string when no plan files exist', () => {
    const result = formatActivePlanForPrompt(tmpDir)
    expect(result).toBe('')
  })

  it('returns empty string when no pending items exist', () => {
    createPlanFile(tmpDir, '.lonny/complete.md', `## Plan\nDone\n## Todo\n- [x] all done`)
    const result = formatActivePlanForPrompt(tmpDir)
    expect(result).toBe('')
  })

  it('formats a plan with pending items for prompt injection', () => {
    createPlanFile(
      tmpDir,
      '.lonny/feature-x.md',
      `## Plan
Add a new feature X with user authentication.

## Todo List
- [ ] Implement login
- [ ] Add tests
- [x] Design schema
`,
    )
    const result = formatActivePlanForPrompt(tmpDir)
    expect(result).toContain('## Active Plan')
    expect(result).toContain('feature-x')
    expect(result).toContain('Add a new feature X')
    expect(result).toContain('Implement login')
    expect(result).toContain('Add tests')
    expect(result).toContain('Remaining Todo (2/3)')
    expect(result).toContain('(1/3 items completed)')
    expect(result).not.toContain('Design schema') // done items not listed
  })

  it('includes multiple plan files if both have pending', () => {
    createPlanFile(tmpDir, '.lonny/plan-a.md', `## Plan\nPlan A\n## Todo\n- [ ] item 1`)
    createPlanFile(tmpDir, '.lonny/plan-b.md', `## Plan\nPlan B\n## Todo\n- [ ] item 2`)
    const result = formatActivePlanForPrompt(tmpDir)
    expect(result).toContain('plan-a')
    expect(result).toContain('plan-b')
  })
})
