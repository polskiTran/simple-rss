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

/** Runs `docker` and returns its result, including a non-zero exit code. */
export async function docker(args: string[]): Promise<DockerResult> {
  try {
    const { stdout, stderr } = await run('docker', args, { maxBuffer: 32 * 1024 * 1024 })
    return { stdout, stderr, code: 0 }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number; message: string }
    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message, code: failure.code ?? 1 }
  }
}

/**
 * Builds for the host architecture, not `linux/amd64`.
 *
 * These tests certify the image's *behaviour*, which is architecture-neutral.
 * That the released image is `linux/amd64` is asserted in CI, which runs on an
 * amd64 runner — see `.github/workflows/ci.yml`. Running this suite on an
 * arm64 machine therefore exercises an arm64 image; the Dockerfile is the same
 * either way, but the architecture claim is not proven locally.
 */
export async function buildImage(): Promise<void> {
  const result = await docker(['build', '-t', IMAGE, '.'])
  if (result.code !== 0) throw new Error(`docker build failed:\n${result.stderr}`)
}

/** A named volume standing in for the platform's persistent disk. */
export function uniqueName(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

export interface Container {
  readonly name: string
  /** Origin on the host, e.g. `http://127.0.0.1:49154`. */
  readonly url: string
  fetch(path: string, init?: RequestInit): Promise<Response>
  exec(args: string[]): Promise<DockerResult>
  logs(): Promise<string>
  /** Sends SIGTERM and waits, returning how long the stop took and its code. */
  stop(timeoutSeconds?: number): Promise<{ durationMs: number; exitCode: number }>
  remove(): Promise<void>
}

export interface StartOptions {
  readonly volume: string
  readonly env?: Record<string, string>
  /** Container port to publish; matches PORT when that is overridden. */
  readonly port?: number
}

/**
 * Starts the published image the way a platform would: an injected port, a
 * volume at `/app/data`, and nothing else.
 */
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

  await waitForReady(container)
  return container
}

/** Polls readiness the way a platform health check does. */
export async function waitForReady(container: Container, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await container.fetch('/health/ready')
      if (response.ok) return
    } catch {
      // Container is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`container ${container.name} never became ready:\n${await container.logs()}`)
}

/** Parses the container's structured stdout into records. */
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
