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
  PORT: port.default(8080),
  DATA_DIR: z.string().trim().min(1).default('./.data'),
  CLIENT_DIR: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
  SETUP_SECRET: z.string().trim().min(1).optional(),
  PUBLIC_ORIGIN: publicOrigin,
  TRUST_PROXY_HEADERS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  ALLOW_RESERVED_FETCH_DESTINATIONS: z.string().optional(),
  NODE_ENV: z.string().optional(),
})

const configSchema = envSchema.transform((env) => {
  const dataDir = resolve(env.DATA_DIR)
  return {
    port: env.PORT,
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE),
    clientDir: env.CLIENT_DIR ? resolve(env.CLIENT_DIR) : defaultClientDir(),
    logLevel: env.LOG_LEVEL,
    shutdownGraceMs: env.SHUTDOWN_GRACE_MS,
    setupSecret: env.SETUP_SECRET,
    publicOrigin: env.PUBLIC_ORIGIN,
    trustProxyHeaders: env.TRUST_PROXY_HEADERS,
    reservedFetchMode: readReservedFetchMode(env),
  }
})

export type ReservedFetchMode = 'blocked' | 'benchmark' | 'ignored'

export function readReservedFetchMode(env: {
  readonly ALLOW_RESERVED_FETCH_DESTINATIONS?: string | undefined
  readonly NODE_ENV?: string | undefined
}): ReservedFetchMode {
  if (env.ALLOW_RESERVED_FETCH_DESTINATIONS !== 'true') return 'blocked'
  return env.NODE_ENV === 'production' ? 'ignored' : 'benchmark'
}

export type Config = Readonly<z.output<typeof configSchema>>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = configSchema.safeParse(pickDefined(env))
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${formatIssues(parsed.error)}`)
  }
  return parsed.data
}

function defaultClientDir(): string {
  const serverDir = fileURLToPath(new URL('.', import.meta.url))
  return resolve(serverDir, '..', 'client')
}

function pickDefined(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries = Object.entries(env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '',
  )
  return Object.fromEntries(entries)
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
}
