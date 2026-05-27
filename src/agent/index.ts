import type { Config } from '../config/index.js'
import { Session } from './session.js'

export async function runAgent(prompt: string, config: Config): Promise<void> {
  const session = Session.load(config) || new Session(config)
  await session.chat(prompt)
}
