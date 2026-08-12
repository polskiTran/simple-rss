import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const DATABASE_FILE = 'simple-rss.db'

const port = z.coerce.number().int().min(1).max(65_535)

const publicOrigin = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must use HTTP or HTTPS' })
    }
    if (url.username !== '' || url.password !== '') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must not contain credentials' })
    }
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'must be an origin without a path, query, or fragment' })
    }
  })
  .transform((value) => new URL(value).origin)

const envSchema = z.object({
  /** Injected by the host platform; the container must not hard-code a port. */
  PORT: port.default(8080),
  /**
   * The mounted volume; everything durable lives below it. The container image
   * sets this explicitly — the default only serves local development.
   */
  DATA_DIR: z.string().trim().min(1).default('./.data'),
  /** Built client assets. Absent during `vite dev`, where Vite serves them. */
  CLIENT_DIR: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** How long in-flight requests may finish after SIGTERM. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
  /**
   * The Setup Secret, inert once the installation is claimed. Optional here so
   * an absent or unusable secret keeps readiness closed with a readable reason
   * instead of crash-looping the container.
   */
  SETUP_SECRET: z.string().trim().min(1).optional(),
  /** Required so outbound retrieval can always refuse a URL pointing back at this API. */
  PUBLIC_ORIGIN: publicOrigin,
  /**
   * Whether `X-Forwarded-For` may be believed: true behind the documented
   * platform proxy, false when exposed directly and the header is attacker-controlled.
   */
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})

export interface Config {
  readonly port: number
  readonly dataDir: string
  readonly databasePath: string
  readonly clientDir: string
  readonly logLevel: LogLevel
  readonly shutdownGraceMs: number
  readonly setupSecret: string | undefined
  readonly publicOrigin: string
  readonly trustProxyHeaders: boolean
}

/** Fails at startup rather than at the first request that trips over a bad value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(pickDefined(env))
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${formatIssues(parsed.error)}`)
  }

  const dataDir = resolve(parsed.data.DATA_DIR)
  const clientDir = parsed.data.CLIENT_DIR
    ? resolve(parsed.data.CLIENT_DIR)
    : defaultClientDir()

  return {
    port: parsed.data.PORT,
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE),
    clientDir,
    logLevel: parsed.data.LOG_LEVEL,
    shutdownGraceMs: parsed.data.SHUTDOWN_GRACE_MS,
    setupSecret: parsed.data.SETUP_SECRET,
    publicOrigin: parsed.data.PUBLIC_ORIGIN,
    trustProxyHeaders: parsed.data.TRUST_PROXY_HEADERS,
  }
}

/**
 * Compiled output lives at `dist/server/`, the client bundle one directory up.
 * Resolving from the module keeps this independent of the working directory.
 */
function defaultClientDir(): string {
  const serverDir = fileURLToPath(new URL('.', import.meta.url))
  return resolve(serverDir, '..', 'client')
}

/**
 * Zod's `.default()` only covers absent keys, but an unset platform variable
 * often arrives as an empty string; dropping empties lets the defaults win.
 */
function pickDefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
  )
  return Object.fromEntries(entries)
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}
