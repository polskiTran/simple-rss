import type { JsonValue } from '../shared/json.js'
import type { LogLevel } from './config.js'

export type LogValue = JsonValue

export type LogField = LogValue | Error
export type LogFields = Readonly<Record<string, LogField>>

export interface LogRecord extends Readonly<Record<string, LogValue>> {
  readonly level: LogLevel
  readonly message: string
  readonly time: string
}

/** Converts JavaScript's unconstrained thrown values into the logger's concrete error contract. */
export function errorForLog(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export interface Logger {
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  /** A logger that stamps `fields` onto everything it writes. */
  child(fields: LogFields): Logger
}

export interface LoggerOptions {
  level: LogLevel
  now?: () => Date
  sink?: (record: LogRecord) => void
  /** Where JSON lines go when no `sink` is given. Defaults to stdout. */
  stream?: { write(chunk: string): void }
}

const RANK = { debug: 0, info: 1, warn: 2, error: 3 } satisfies Record<LogLevel, number>

/**
 * Flat JSON records to stdout. Callers pass event names (`server.started`),
 * never secrets, session tokens, Feed summaries, or Reader content.
 */
export function createLogger(options: LoggerOptions): Logger {
  const now = options.now ?? (() => new Date())
  const stream = options.stream ?? process.stdout
  const write = options.sink ?? ((record: LogRecord) => void stream.write(`${JSON.stringify(record)}\n`))
  const threshold = RANK[options.level]

  function build(bound: LogFields): Logger {
    const emit = (level: LogLevel, message: string, fields?: LogFields) => {
      if (RANK[level] < threshold) return
      write({ ...bound, ...serialiseFields(fields), level, message, time: now().toISOString() })
    }

    return {
      debug: (message, fields) => emit('debug', message, fields),
      info: (message, fields) => emit('info', message, fields),
      warn: (message, fields) => emit('warn', message, fields),
      error: (message, fields) => emit('error', message, fields),
      child: (fields) => build({ ...bound, ...serialiseFields(fields) }),
    }
  }
  return build({})
}

interface SerialisedFields {
  [key: string]: LogValue
}

/** Converts every field to a value `JSON.stringify` can emit without throwing. */
function serialiseFields(fields: LogFields | undefined): SerialisedFields {
  if (!fields) return {}

  const seen = new WeakSet<object>()
  const out: Record<string, LogValue> = {}
  for (const [key, value] of Object.entries(fields)) out[key] = serialiseValue(value, seen)
  return out
}

function serialiseValue(value: unknown, seen: WeakSet<object>): LogValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? '' }
  }
  if (Array.isArray(value)) return value.map((entry) => serialiseValue(entry, seen))
  if (typeof value !== 'object') return `[${typeof value}]`
  if (seen.has(value)) return '[Circular]'

  seen.add(value)
  const out: Record<string, LogValue> = {}
  for (const [key, child] of Object.entries(value)) out[key] = serialiseValue(child, seen)
  seen.delete(value)
  return out
}
