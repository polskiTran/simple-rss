import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const IMAGE = 'simple-rss:smoke'

export interface DockerResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export async function docker(args: string[]): Promise<DockerResult> {
  try {
    const { stdout, stderr } = await run('docker', args, { maxBuffer: 32 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number; message: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message, code: failure.code ?? 1 }
  }
}

export async function buildImage(): Promise<void> {
  const result = await docker(['build', '-t', IMAGE, '.'])
  if (result.code !== 0) throw new Error(`docker build failed:\n${result.stderr}`)
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

export interface Container {
  readonly name: string
  readonly url: string
  fetch(path: string, init?: RequestInit): Promise<Response>
  exec(args: string[]): Promise<DockerResult>
  logs(): Promise<string>
  stop(timeoutSeconds?: number): Promise<{ durationMs: number; exitCode: number }>
  remove(): Promise<void>
}

export interface StartOptions {
  readonly volume: string
  readonly env?: Record<string, string>
  readonly port?: number
  readonly waitForReadiness?: boolean
}

export async function startContainer(options: StartOptions): Promise<Container> {
  const name = uniqueName('simple-rss-smoke')
  const port = options.port ?? 8080
  const env = Object.entries(options.env ?? {}).flatMap(([key, value]) => ['-e', `${key}=${value}`])

  const started = await docker([
    'run',
    '-d',
    '--name',
    name,
    '-v',
    `${options.volume}:/app/data`,
    '-p',
    `127.0.0.1::${port}`,
    ...env,
    IMAGE,
  ])
  if (started.code !== 0) throw new Error(`docker run failed:\n${started.stderr}`)

  const published = await docker(['port', name, String(port)])
  const hostPort = published.stdout.trim().split('\n')[0]?.split(':').pop()
  if (!hostPort) throw new Error(`could not read published port:\n${published.stdout}${published.stderr}`)

  const url = `http://127.0.0.1:${hostPort}`

  const container: Container = {
    name,
    url,
    fetch: (path, init) => fetch(new URL(path, url), init),
    exec: (args) => docker(['exec', name, ...args]),
    logs: async () => {
      const result = await docker(['logs', name])
      return `${result.stdout}\n${result.stderr}`
    },
    async stop(timeoutSeconds = 30) {
      const startedAt = Date.now()
      await docker(['stop', '-t', String(timeoutSeconds), name])
      const durationMs = Date.now() - startedAt
      const inspected = await docker(['inspect', '-f', '{{.State.ExitCode}}', name])
      return { durationMs, exitCode: Number(inspected.stdout.trim()) }
    },
    async remove() {
      await docker(['rm', '-f', name])
    },
  }

  if (options.waitForReadiness ?? true) await waitForReady(container)
  else await waitForLiveness(container)

  return container
}

export async function waitForLiveness(container: Container, timeoutMs = 60_000): Promise<void> {
  await waitFor(container, timeoutMs, '/health/live', (response) => response.ok)
}

export async function waitForReady(container: Container, timeoutMs = 60_000): Promise<void> {
  await waitFor(container, timeoutMs, '/health/ready', (response) => response.ok)
}

async function waitFor(
  container: Container,
  timeoutMs: number,
  path: string,
  accept: (response: Response) => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      if (accept(await container.fetch(path))) return
    } catch {
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`container ${container.name} never answered ${path}:\n${await container.logs()}`)
}

export function logRecords(logs: string): Array<Record<string, unknown>> {
  return logs
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
}
