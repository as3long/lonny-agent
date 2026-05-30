import { describe, expect, test } from 'vitest'
import { getContextWindowForModel } from '../index.js'

describe('getContextWindowForModel', () => {
  // 精确匹配测试
  test('exact match with known model names', () => {
    expect(getContextWindowForModel('doubao-seed-2.0-code')).toBe(256_000)
    expect(getContextWindowForModel('deepseek-v4-pro')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen3.6-plus')).toBe(1_000_000)
    expect(getContextWindowForModel('claude-sonnet-4.6')).toBe(1_000_000)
    expect(getContextWindowForModel('gpt-5.5')).toBe(1_000_000)
  })

  // 大小写不敏感测试
  test('case insensitive matching', () => {
    expect(getContextWindowForModel('DOUBAO-SEED-2.0-CODE')).toBe(256_000)
    expect(getContextWindowForModel('DeepSeek-V4-Pro')).toBe(1_000_000)
    expect(getContextWindowForModel('QWEN3.6-PLUS')).toBe(1_000_000)
  })

  // 模糊匹配 - 含空格的变体
  test('fuzzy match with space variants', () => {
    expect(getContextWindowForModel('doubao seed 2.0 code')).toBe(256_000)
    expect(getContextWindowForModel('deepseek v4 pro')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen 3.6 plus')).toBe(1_000_000)
  })

  // 模糊匹配 - 下划线与连字符变体
  test('fuzzy match with underscore and hyphen variants', () => {
    expect(getContextWindowForModel('doubao_seed_2.0_code')).toBe(256_000)
    expect(getContextWindowForModel('deepseek_v4_pro')).toBe(1_000_000)
  })

  // 模糊匹配 - 含前缀和后缀的模型名
  test('fuzzy match with prefixed and suffixed model names', () => {
    expect(getContextWindowForModel('my-doubao-seed-2.0-code')).toBe(256_000)
    expect(getContextWindowForModel('deepseek-v4-pro-variant')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen3.6-plus-prod')).toBe(1_000_000)
  })

  // 模糊匹配 - 关键词匹配（不完整的模型名）
  test('fuzzy match with keyword matching (partial model names)', () => {
    // 百万上下文模型
    expect(getContextWindowForModel('deepseek-v4')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen3.6')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen3.7')).toBe(1_000_000)
    expect(getContextWindowForModel('claude opus 4.7')).toBe(1_000_000)
    expect(getContextWindowForModel('gemini 2.5')).toBe(1_000_000)

    // 256K 上下文模型
    expect(getContextWindowForModel('doubao-seed-2.0')).toBe(256_000)
    expect(getContextWindowForModel('kimi-k2.5')).toBe(262_144) // 实际值
    expect(getContextWindowForModel('kimi-k2.6')).toBe(262_144) // 实际值

    // 200K 上下文模型
    expect(getContextWindowForModel('minimax')).toBe(200_000)
    expect(getContextWindowForModel('glm-5')).toBe(200_000)
    expect(getContextWindowForModel('glm-5.1')).toBe(200_000)
    expect(getContextWindowForModel('claude-haiku')).toBe(200_000)

    // 160K 上下文模型
    expect(getContextWindowForModel('deepseek-v3')).toBe(160_000)
    expect(getContextWindowForModel('deepseek-v3.2')).toBe(160_000)

    // 128K 上下文模型
    expect(getContextWindowForModel('gpt-4o')).toBe(128_000)
    expect(getContextWindowForModel('gpt-4')).toBe(128_000)
    expect(getContextWindowForModel('llama-3')).toBe(128_000)
  })

  // 未知模型名 - 兜底默认值
  test('unknown model names return default 128K', () => {
    expect(getContextWindowForModel('unknown-model')).toBe(128_000)
    expect(getContextWindowForModel('random-model-name')).toBe(128_000)
  })

  // 用户配置中常用的模型名
  test('common model names from user configs', () => {
    // 豆包模型
    expect(getContextWindowForModel('Doubao-Seed-2.0-Code')).toBe(256_000)

    // DeepSeek 模型
    expect(getContextWindowForModel('deepseek-chat')).toBe(128_000)
    expect(getContextWindowForModel('deepseek-reasoner')).toBe(128_000)

    // Kimi 模型
    expect(getContextWindowForModel('kimi-k2.5')).toBe(262_144) // 实际值
    expect(getContextWindowForModel('kimi-k2.6')).toBe(262_144) // 实际值

    // 通义千问
    expect(getContextWindowForModel('qwen3.6-plus')).toBe(1_000_000)
    expect(getContextWindowForModel('qwen3.7-max')).toBe(1_000_000)
  })
})
