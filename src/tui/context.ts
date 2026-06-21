import type { InjectionKey, Ref } from 'vue'
import type { Config } from '../config/index.js'

export interface TuiContext {
  config: Config
  chatContent: Ref<string>
  isRunning: Ref<boolean>
  pendingConfirm: Ref<((approved: boolean) => void) | null>
  showPlans: Ref<boolean>
  showHelp: Ref<boolean>
  showPlanDetail: Ref<boolean>
  selectedPlanName: Ref<string>
  statusData: Ref<StatusData>
}

export interface StatusData {
  mode: string
  agentStatus: 'running' | 'idle'
  model: string
  provider: string
  planCount: number
  planName: string
  totalInputTokens: number
  totalOutputTokens: number
  totalApiCalls: number
  balance: string
  webBalance: string
  phase: 'landing' | 'chat'
  planFilter: string
}

export const kConfig: InjectionKey<Config> = Symbol('config')
export const kChatContent: InjectionKey<Ref<string>> = Symbol('chatContent')
export const kIsRunning: InjectionKey<Ref<boolean>> = Symbol('isRunning')
export const kPendingConfirm: InjectionKey<Ref<((approved: boolean) => void) | null>> =
  Symbol('pendingConfirm')
export const kShowPlans: InjectionKey<Ref<boolean>> = Symbol('showPlans')
export const kShowPlanDetail: InjectionKey<Ref<boolean>> = Symbol('showPlanDetail')
export const kSelectedPlanName: InjectionKey<Ref<string>> = Symbol('selectedPlanName')
export const kStatusData: InjectionKey<Ref<StatusData>> = Symbol('statusData')
export const kPlansVersion: InjectionKey<Ref<number>> = Symbol('plansVersion')
