/**
 * Per-provider/model pricing (USD per 1M tokens).
 * Sources: official pricing pages as of early 2026.
 */
export interface ModelPricing {
  inputPer1M: number // Cost per 1M input tokens
  outputPer1M: number // Cost per 1M output tokens
  /** Name for display */
  label?: string
}

/** Full pricing table keyed by model name (lowercase prefix match). */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // ── DeepSeek ─────────────────────────────────────────────────────
  'deepseek-v4-pro': { inputPer1M: 2.0, outputPer1M: 8.0, label: 'DeepSeek V4 Pro' },
  'deepseek-v4-flash': { inputPer1M: 0.35, outputPer1M: 1.4, label: 'DeepSeek V4 Flash' },
  'deepseek-v3.2': { inputPer1M: 0.5, outputPer1M: 2.0, label: 'DeepSeek V3.2' },
  'deepseek-r1': { inputPer1M: 0.55, outputPer1M: 2.19, label: 'DeepSeek R1' },
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1, label: 'DeepSeek Chat' },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19, label: 'DeepSeek Reasoner' },

  // ── Claude ───────────────────────────────────────────────────────
  'claude-opus-4.7': { inputPer1M: 15.0, outputPer1M: 75.0, label: 'Claude Opus 4.7' },
  'claude-opus-4.6': { inputPer1M: 15.0, outputPer1M: 75.0, label: 'Claude Opus 4.6' },
  'claude-sonnet-4.6': { inputPer1M: 3.0, outputPer1M: 15.0, label: 'Claude Sonnet 4.6' },
  'claude-haiku-4.5': { inputPer1M: 0.8, outputPer1M: 4.0, label: 'Claude Haiku 4.5' },

  // ── GPT ──────────────────────────────────────────────────────────
  'gpt-5.5': { inputPer1M: 10.0, outputPer1M: 40.0, label: 'GPT-5.5' },
  'gpt-5.4': { inputPer1M: 10.0, outputPer1M: 40.0, label: 'GPT-5.4' },
  'gpt-5.1': { inputPer1M: 10.0, outputPer1M: 40.0, label: 'GPT-5.1' },
  'gpt-5.2-codex': { inputPer1M: 10.0, outputPer1M: 40.0, label: 'GPT-5.2 Codex' },
  'gpt-4.1': { inputPer1M: 2.0, outputPer1M: 8.0, label: 'GPT-4.1' },
  'gpt-4.1-mini': { inputPer1M: 0.4, outputPer1M: 1.6, label: 'GPT-4.1 Mini' },
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0, label: 'GPT-4o' },

  // ── Gemini ───────────────────────────────────────────────────────
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 5.0, label: 'Gemini 2.5 Pro' },
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Gemini 2.5 Flash' },
  'gemini-3.1-pro': { inputPer1M: 1.25, outputPer1M: 5.0, label: 'Gemini 3.1 Pro' },
  'gemini-3.1-flash': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Gemini 3.1 Flash' },

  // ── Qwen ─────────────────────────────────────────────────────────
  'qwen3.7-max': { inputPer1M: 3.0, outputPer1M: 12.0, label: 'Qwen 3.7 Max' },
  'qwen3-max': { inputPer1M: 2.0, outputPer1M: 8.0, label: 'Qwen 3 Max' },
  'qwen3.6-plus': { inputPer1M: 2.0, outputPer1M: 8.0, label: 'Qwen 3.6 Plus' },
  'qwen3.5-plus': { inputPer1M: 2.0, outputPer1M: 8.0, label: 'Qwen 3.5 Plus' },
  'qwen-flash': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Qwen Flash' },

  // ── Doubao ───────────────────────────────────────────────────────
  'doubao-seed-2.0-pro': { inputPer1M: 0.8, outputPer1M: 2.0, label: 'Doubao Seed 2.0 Pro' },
  'doubao-seed-2.0-lite': { inputPer1M: 0.4, outputPer1M: 1.0, label: 'Doubao Seed 2.0 Lite' },
  'doubao-seed-2.0-mini': { inputPer1M: 0.15, outputPer1M: 0.6, label: 'Doubao Seed 2.0 Mini' },

  // ── Ollama (local — free) ────────────────────────────────────────
  ollama: { inputPer1M: 0, outputPer1M: 0, label: 'Ollama (local)' },
}

/** Fallback pricing for unknown models */
const FALLBACK_PRICING: ModelPricing = { inputPer1M: 0.5, outputPer1M: 2.0, label: 'Unknown model' }

/**
 * Look up pricing for a given model name.
 * Uses prefix matching so "deepseek-v4-flash" matches the "deepseek-v4-flash" entry.
 */
export function getPricing(model: string, provider?: string): ModelPricing {
  // Try exact match first
  const exact = PRICING_TABLE[model]
  if (exact) return exact

  // Try lowercase
  const lower = model.toLowerCase()
  const exactLower = PRICING_TABLE[lower]
  if (exactLower) return exactLower

  // Try prefix match (longest match)
  let bestMatch: { key: string; pricing: ModelPricing } | null = null
  for (const [key, pricing] of Object.entries(PRICING_TABLE)) {
    if (lower.includes(key) || key.includes(lower)) {
      if (!bestMatch || key.length > bestMatch.key.length) {
        bestMatch = { key, pricing }
      }
    }
  }
  if (bestMatch) return bestMatch.pricing

  // Ollama fallback via provider name
  if (provider === 'ollama') return PRICING_TABLE['ollama']

  return FALLBACK_PRICING
}

/**
 * Calculate estimated cost from token usage and pricing.
 * Returns cost in USD, rounded to 4 decimal places.
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M
  return Math.round((inputCost + outputCost) * 10000) / 10000
}

/**
 * Format a USD cost value for display.
 * Examples: "$0.00", "$0.12", "$1.50", "$12.30", "$123.45"
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) return '<$0.01'
  if (cost >= 1000) return `$${(cost / 1000).toFixed(1)}k`
  return `$${cost.toFixed(2)}`
}
