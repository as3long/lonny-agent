import { Session } from './session.js'
import { Config } from '../config/index.js'

export async function runAgent(prompt: string, config: Config): Promise<void> {
  const session = Session.load(config) || new Session(config)
  await session.chat(prompt)
}