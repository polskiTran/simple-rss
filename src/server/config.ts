import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** File name of the single database inside the durable data directory. */
export const DATABASE_FILE = 'simple-rss.db'

const port = z.coerce.number().int().min(1).max(65_535)

const envSchema = z.object({
  /**
   * Supplied by the host platform. Railway injects it; the container must not
   * hard-code a port.
   */
  PORT: port.default(8080),
  /**
   * The mounted volume. Everything durable lives below it, so replacing the
   * container preserves state. The container image sets this explicitly; the
   * default only serves local development.
   */
  DATA_DIR: z.string().trim().min(1).default('./.data'),
  /** Built client assets. Absent during `vite dev`, where Vite serves them. */
  CLIENT_DIR: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  /** How long in-flight requests may finish after SIGTERM. */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
  /**
   * The one-time secret that lets the first visitor become the Owner. Required
   * until the installation is claimed, after which it does nothing.
   *
   * Deliberately optional here: an absent or unusable secret keeps readiness
   * closed with a reason an operator can read, rather than crash-looping the
   * container past them. `MIN_SETUP_SECRET_LENGTH` is the usable bar.
   */
  SETUP_SECRET: z.string().trim().min(1).optional(),
  /**
   * Whether `X-Forwarded-For` may be believed. True for the documented
   * deployment, where the platform's proxy terminates TLS and every socket
   * appears to come from it; false when the service is exposed directly, where
   * the header is attacker-controlled.
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
  readonly trustProxyHeaders: boolean
}

/**
 * Turns the process environment into the settings the service needs, failing
 * at startup rather than at the first request that trips over a bad value.
 */
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
    trustProxyHeaders: parsed.data.TRUST_PROXY_HEADERS,
  }
}

/**
 * Compiled output lives at `dist/server/config.js`, so the sibling client
 * bundle is one directory up. Resolving from the module keeps the service
 * working regardless of the working directory it is started from.
 */
function defaultClientDir(): string {
  const serverDir = fileURLToPath(new URL('.', import.meta.url))
  return resolve(serverDir, '..', 'client')
}

/**
 * Zod's `.default()` only applies to absent keys, but an unset platform
 * variable often arrives as an empty string. Dropping empties lets the
 * declared defaults win while a genuinely malformed value still fails.
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
