import * as cp from 'node:child_process'
import { NPM_REGISTRY_URL } from './constants.js'

/** Fetch package info from npm registry */
export async function fetchNpmPackageInfo(
  packageName: string,
): Promise<{ description: string; readme: string } | null> {
  try {
    const response = await fetch(`${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`, {
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return null

    const data = (await response.json()) as {
      description?: string
      readme?: string
    }
    return {
      description: data.description || '',
      readme: data.readme || '',
    }
  } catch {
    return null
  }
}

/** Run npm install in the project directory */
export async function runNpmInstall(cwd: string, packageName: string): Promise<string | null> {
  return new Promise(resolve => {
    const child = cp.spawn('npm', ['install', packageName], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    const timeout = setTimeout(() => {
      child.kill()
      resolve(`Timed out after 60s. ${stderr.slice(0, 500)}`)
    }, 60_000)

    child.on('close', code => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(null) // success
      } else {
        resolve(stderr.slice(0, 500) || `npm install exited with code ${code}`)
      }
    })

    child.on('error', err => {
      clearTimeout(timeout)
      resolve(`Failed to start npm install: ${err.message}`)
    })
  })
}
