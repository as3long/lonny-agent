/**
 * DeepSeek account balance fetcher.
 * Only used when the configured baseUrl contains "api.deepseek.com".
 */

import { fmtErr } from '../tools/errors.js'

export interface DeepSeekBalance {
  isAvailable: boolean
  /** Formatted display string, e.g. "¥110.00" */
  display: string
  /**
   * Web-style display with breakdown, e.g. "¥110.00 (赠¥10.00 充¥100.00)".
   * Shows the same breakdown visible on the DeepSeek web platform.
   */
  webDisplay: string
  raw: {
    totalBalance: string
    grantedBalance: string
    toppedUpBalance: string
    currency: string
  }
  error?: string
}

/**
 * Fetch DeepSeek account balance.
 * @param apiKey - DeepSeek API key
 * @returns Parsed balance info, or an error object
 */
export async function fetchDeepSeekBalance(apiKey: string): Promise<DeepSeekBalance> {
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      return {
        isAvailable: false,
        display: '',
        webDisplay: '',
        raw: { totalBalance: '0', grantedBalance: '0', toppedUpBalance: '0', currency: '' },
        error: `HTTP ${res.status}`,
      }
    }

    const data = (await res.json()) as {
      is_available: boolean
      balance_infos?: Array<{
        currency: string
        total_balance: string
        granted_balance: string
        topped_up_balance: string
      }>
    }

    if (!data.balance_infos || data.balance_infos.length === 0) {
      return {
        isAvailable: data.is_available,
        display: '',
        webDisplay: '',
        raw: { totalBalance: '0', grantedBalance: '0', toppedUpBalance: '0', currency: '' },
        error: 'no balance info',
      }
    }

    const info = data.balance_infos[0]
    const symbol = info.currency === 'CNY' ? '¥' : '$'
    const display = `${symbol}${info.total_balance}`

    // Build web-style display with breakdown (granted + topped-up)
    const grantedLabel = '赠'
    const topupLabel = '充'
    const webDisplay = `${display} (${grantedLabel}${symbol}${info.granted_balance} ${topupLabel}${symbol}${info.topped_up_balance})`

    return {
      isAvailable: data.is_available,
      display,
      webDisplay,
      raw: {
        totalBalance: info.total_balance,
        grantedBalance: info.granted_balance,
        toppedUpBalance: info.topped_up_balance,
        currency: info.currency,
      },
    }
  } catch (err) {
    const msg = fmtErr(err)
    return {
      isAvailable: false,
      display: '',
      webDisplay: '',
      raw: { totalBalance: '0', grantedBalance: '0', toppedUpBalance: '0', currency: '' },
      error: msg,
    }
  }
}

/** Check if the given baseUrl is DeepSeek's official API. */
export function isDeepSeekOfficial(baseUrl?: string): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    return url.hostname === 'api.deepseek.com'
  } catch {
    return baseUrl.includes('api.deepseek.com')
  }
}
