import * as readline from 'node:readline'
import type { Config } from '../config/index.js'
import { Session, type SessionOutput } from './session.js'

export async function runAgent(prompt: string, config: Config): Promise<void> {
  const output: SessionOutput = {
    write: text => process.stdout.write(text),
    confirmTool: async toolCalls => {
      console.log('\nAllow these tool calls?')
      for (const tc of toolCalls) {
        const input = JSON.stringify(tc.input)
        console.log(`  \u2022 ${tc.name}: ${input.slice(0, 120)}`)
      }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      return new Promise(resolve => {
        rl.question('  (y/N) ', answer => {
          rl.close()
          resolve(answer.trim().toLowerCase() === 'y')
        })
      })
    },
  }
  const session = Session.load(config, output) || new Session(config, output)
  await session.chat(prompt)
}
