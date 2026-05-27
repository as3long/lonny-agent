import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

describe('Skills system', () => {
  let tmpDir: string
  let skillsDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lonny-skills-test-'))
    skillsDir = path.join(tmpDir, '.lonny', 'skills')
    fs.mkdirSync(skillsDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('loadSkills returns empty array when no skills directory', async () => {
    const { loadSkills } = await import('../skills.js')
    const emptyDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'no-skills-')), 'nope')
    const skills = loadSkills(emptyDir)
    expect(skills).toEqual([])
  })

  test('loadSkills returns empty array when skills directory is empty', async () => {
    const { loadSkills } = await import('../skills.js')
    const skills = loadSkills(tmpDir)
    expect(skills).toEqual([])
  })

  test('loadSkills loads a skill with frontmatter', async () => {
    const { loadSkills } = await import('../skills.js')
    fs.writeFileSync(
      path.join(skillsDir, 'test-skill.md'),
      '---\nname: my-skill\ndescription: A test skill\n---\nDo this thing',
    )
    const skills = loadSkills(tmpDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('my-skill')
    expect(skills[0].description).toBe('A test skill')
    expect(skills[0].content).toBe('Do this thing')
  })

  test('loadSkills uses filename as name when no frontmatter name', async () => {
    const { loadSkills } = await import('../skills.js')
    fs.writeFileSync(path.join(skillsDir, 'no-frontmatter.md'), 'Just instructions')
    const skills = loadSkills(tmpDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('no-frontmatter')
    expect(skills[0].description).toBe('')
    expect(skills[0].content).toBe('Just instructions')
  })

  test('loadSkills skips files with invalid names', async () => {
    const { loadSkills } = await import('../skills.js')
    fs.writeFileSync(path.join(skillsDir, 'bad name.md'), '---\nname: BAD NAME\n---\ncontent')
    fs.writeFileSync(path.join(skillsDir, 'good-skill.md'), '---\nname: good-skill\n---\ndo stuff')
    const skills = loadSkills(tmpDir)
    expect(skills).toHaveLength(1)
    expect(skills[0].name).toBe('good-skill')
  })

  test('loadSkills skips non-.md files', async () => {
    const { loadSkills } = await import('../skills.js')
    fs.writeFileSync(path.join(skillsDir, 'readme.txt'), 'not a skill')
    const skills = loadSkills(tmpDir)
    expect(skills).toHaveLength(0)
  })

  test('formatSkillsForPrompt returns empty string for no skills', async () => {
    const { formatSkillsForPrompt } = await import('../skills.js')
    expect(formatSkillsForPrompt([])).toBe('')
  })

  test('formatSkillsForPrompt formats skills correctly', async () => {
    const { formatSkillsForPrompt, loadSkills } = await import('../skills.js')
    fs.writeFileSync(
      path.join(skillsDir, 'skill-a.md'),
      '---\nname: skill-a\ndescription: First skill\n---\nDo A',
    )
    fs.writeFileSync(path.join(skillsDir, 'skill-b.md'), '---\nname: skill-b\n---\nDo B')
    const skills = loadSkills(tmpDir)
    const formatted = formatSkillsForPrompt(skills)
    expect(formatted).toContain('skill-a')
    expect(formatted).toContain('First skill')
    expect(formatted).toContain('Do A')
    expect(formatted).toContain('skill-b')
    expect(formatted).toContain('Do B')
  })

  test('ensureSkillsDir creates the directory', async () => {
    const { ensureSkillsDir } = await import('../skills.js')
    const newDir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-test-')),
      'nested',
      'path',
    )
    expect(fs.existsSync(newDir)).toBe(false)
    ensureSkillsDir(newDir)
    expect(fs.existsSync(newDir)).toBe(true)
  })
})
