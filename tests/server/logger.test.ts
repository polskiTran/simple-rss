import { describe, expect, it } from 'vitest'
import { createLogger, type LogRecord } from '../../src/server/logger.js'

function collect() {
  const written: LogRecord[] = []
  return { written, sink: (record: LogRecord) => written.push(record) }
}

const at = () => new Date('2026-08-08T09:00:00.000Z')

describe('createLogger', () => {
  it('writes a structured record with level, message, and time', () => {
    const { written, sink } = collect()
    const logger = createLogger({ level: 'info', now: at, sink })

    logger.info('server.started', { port: 8080 })

    expect(written).toEqual([
      { level: 'info', message: 'server.started', time: '2026-08-08T09:00:00.000Z', port: 8080 },
    ])
  })

  it('drops records below the configured level', () => {
    const { written, sink } = collect()
    const logger = createLogger({ level: 'warn', now: at, sink })

    logger.debug('noise')
    logger.info('also noise')
    logger.warn('kept')
    logger.error('kept too')

    expect(written.map((record) => record.message)).toEqual(['kept', 'kept too'])
  })

  it('carries bound fields onto every record from a child logger', () => {
    const { written, sink } = collect()
    const logger = createLogger({ level: 'info', now: at, sink }).child({ component: 'http' })

    logger.info('request.completed', { status: 200 })

    expect(written[0]).toMatchObject({ component: 'http', status: 200 })
  })

  it('serialises an error into message and stack without throwing', () => {
    const { written, sink } = collect()
    const logger = createLogger({ level: 'info', now: at, sink })

    logger.error('startup.failed', { error: new Error('volume is full') })

    expect(written[0]?.error).toMatchObject({ message: 'volume is full', name: 'Error' })
    expect(typeof (written[0]?.error as { stack: string }).stack).toBe('string')
  })

  it('never lets a field overwrite level, message, or time', () => {
    const { written, sink } = collect()
    const logger = createLogger({ level: 'info', now: at, sink })

    logger.info('real.message', { level: 'error', message: 'spoofed', time: 'yesterday' })

    expect(written[0]).toMatchObject({ level: 'info', message: 'real.message', time: '2026-08-08T09:00:00.000Z' })
  })

  it('writes one JSON line per record to stdout by default', () => {
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      now: at,
      stream: { write: (chunk: string) => void lines.push(chunk) },
    })

    logger.info('server.started', { port: 8080 })

    expect(lines).toHaveLength(1)
    expect(lines[0]?.endsWith('\n')).toBe(true)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', message: 'server.started', port: 8080 })
  })
})
