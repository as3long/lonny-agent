import type { PromptStrategy } from '../prompt-builder-types.js'
import { AskPromptStrategy } from './ask.js'
import { CodePromptStrategy } from './code.js'
import { LoopPromptStrategy } from './loop.js'
import { PlanPromptStrategy } from './plan.js'
import { ReviewPromptStrategy } from './review.js'

const strategyMap: Record<string, PromptStrategy> = {
  code: new CodePromptStrategy(),
  plan: new PlanPromptStrategy(),
  review: new ReviewPromptStrategy(),
  ask: new AskPromptStrategy(),
  loop: new LoopPromptStrategy(),
}

export function getStrategyForMode(mode: string): PromptStrategy {
  const s = strategyMap[mode]
  if (!s) {
    throw new Error(`Unknown mode: ${mode}`)
  }
  return s
}
