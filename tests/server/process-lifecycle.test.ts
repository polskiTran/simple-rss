import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTempDataDir } from '../support/temp-dir.js'

const FATAL_EVENT = {
  exception: 'process.uncaught_exception',
  rejection: 'process.unhandled_rejection',
} as const

describe('fatal process errors', () => {
  it.each(Object.entries(FATAL_EVENT))('logs and exits after an unhandled %s', async (kind, event) => {
    const root = await makeTempDataDir()
    const trigger = join(root, 'fatal-trigger.mjs')
    await writeFile(
      trigger,
      `process.on('SIGUSR2', () => {
        if (process.env.FATAL_KIND === 'rejection') {
          void Promise.reject(new Error('intentional fatal rejection'))
        } else {
          throw new Error('intentional fatal exception')
        }
      })\n`,
    )

    const child = spawn(process.execPath, ['--import', 'tsx', '--import', trigger, 'src/server/main.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLIENT_DIR: 'tests/fixtures/client',
        DATA_DIR: join(root, 'data'),
        FATAL_KIND: kind,
        PORT: String(await freePort()),
        SETUP_SECRET: 'a-long-enough-setup-secret-for-process-tests',
        PUBLIC_ORIGIN: 'https://reader.test',
      },
      stdio: 'pipe',
    })

    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    try {
      await waitForLog(child, () => stdout.includes('server.started'))
      child.kill('SIGUSR2')

      const { code, signal } = await waitForExit(child)

      expect(signal).toBeNull()
      expect(code).not.toBe(0)
      expect(stdout).toContain(event)
    } finally {
      await killIfRunning(child)
    }
  })
})

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('could not reserve a test port')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

function waitForLog(child: ChildProcessWithoutNullStreams, predicate: () => boolean): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const onData = () => {
    if (predicate()) finish()
  }
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    finish(new Error(`service exited before startup: code=${String(code)} signal=${String(signal)}`))
  }
  const finish = (error?: Error) => {
    clearTimeout(timeout)
    child.stdout.off('data', onData)
    child.off('exit', onExit)
    error ? reject(error) : resolve()
  }

  // Bounds a real child process; fake timers cannot drive OS events. Generous
  // because it catches a hang, not races startup: module loading alone costs
  // the child ~500ms while the suite competes for the same cores.
  const timeout = setTimeout(() => finish(new Error('service did not start')), 8_000)
  child.stdout.on('data', onData)
  child.once('exit', onExit)
  onData()
  return promise
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>()
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    clearTimeout(timeout)
    resolve({ code, signal })
  }

  // This watchdog is the assertion that the external process did not exit;
  // fake timers cannot advance a spawned Node process.
  const timeout = setTimeout(() => {
    child.off('exit', onExit)
    reject(new Error('service kept running after a fatal error'))
  }, 1_000)
  child.once('exit', onExit)
  return promise
}

async function killIfRunning(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGKILL')
  await once(child, 'exit')
}
