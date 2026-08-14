import type { LogLevel } from './config.js'

export type LogFields = Record<string, unknown>

export interface LogRecord extends LogFields {
  level: LogLevel
  message: string
  time: string
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
  stream?: { write(chunk: string): unknown }
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

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
      // Level, message, and time are written last so a caller-supplied field
      // can never spoof them.
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

/** `JSON.stringify` drops Error properties, so errors are unpacked by hand. */
function serialiseFields(fields: LogFields | undefined): LogFields {
  if (!fields) return {}

  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack ?? '' } : value
  }
  return out
}
