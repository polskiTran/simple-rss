import type { JsonValue } from '../shared/json.js'
import type { LogLevel } from './config.js'

/**
 * Anything a caller has at hand — thrown values included. The serialiser is
 * total: it reduces every value to JSON and drops undefined fields.
 */
export type LogFields = Readonly<Record<string, unknown>>

export interface LogRecord extends Readonly<Record<string, JsonValue>> {
  readonly level: LogLevel
  readonly message: string
  readonly time: string
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
  [key: string]: JsonValue
}

/** Converts every field to a value `JSON.stringify` can emit without throwing. */
function serialiseFields(fields: LogFields | undefined): SerialisedFields {
  return fields ? serialiseEntries(Object.entries(fields), new WeakSet()) : {}
}

/** Undefined entries are dropped, as `JSON.stringify` would. */
function serialiseEntries(entries: readonly (readonly [string, unknown])[], seen: WeakSet<object>): SerialisedFields {
  const out: SerialisedFields = {}
  for (const [key, value] of entries) {
    if (value !== undefined) out[key] = serialiseValue(value, seen)
  }
  return out
}

function serialiseValue(value: unknown, seen: WeakSet<object>): JsonValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? '' }
  }
  if (Array.isArray(value)) return value.map((entry) => serialiseValue(entry, seen))
  if (typeof value !== 'object') return `[${typeof value}]`
  if (seen.has(value)) return '[Circular]'

  seen.add(value)
  const out = serialiseEntries(Object.entries(value), seen)
  seen.delete(value)
  return out
}
