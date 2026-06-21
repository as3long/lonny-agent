import { createApp } from '@vue-tui/runtime'
import type { Session } from '../agent/session.js'
import type { Config } from '../config/index.js'
import { Root } from './app.js'

export async function startTui(config: Config, preloadedSession?: Session): Promise<void> {
  process.stdout.write('\x1b[2J\x1b[H')

  const app = createApp(Root, { config, preloadedSession: preloadedSession ?? null })

  process.stdout.write(`\x1b]0;lonny ${config.model} ${config.provider}\x07`)

  app.mount({ alternateScreen: true, exitOnCtrlC: true })

  await new Promise<void>(() => {})
}
