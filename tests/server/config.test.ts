import { execFile } from 'node:child_process'
import { copyFile, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/server/config.js'
import { makeTempDataDir } from '../support/temp-dir.js'

const run = promisify(execFile)

describe('loadConfig', () => {
  it('accepts the platform-provided port', () => {
    expect(loadConfig({ PORT: '3123' }).port).toBe(3123)
  })

  it('falls back to 8080 when the platform provides no port', () => {
    expect(loadConfig({}).port).toBe(8080)
  })

  it.each(['0', '-1', '70000', 'eight thousand'])('rejects the unusable port %j', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/)
  })

  it('treats an empty platform variable as unset', () => {
    expect(loadConfig({ PORT: '', LOG_LEVEL: '' }).port).toBe(8080)
  })

  it('puts the database below the configured durable data directory', () => {
    const config = loadConfig({ DATA_DIR: '/mnt/volume' })

    expect(config.dataDir).toBe('/mnt/volume')
    expect(config.databasePath).toBe('/mnt/volume/simple-rss.db')
  })

  it('resolves a relative data directory to an absolute path', () => {
    expect(loadConfig({ DATA_DIR: './.data' }).dataDir).toMatch(/^\//)
  })

  it('rejects an empty data directory rather than writing to the process cwd', () => {
    expect(() => loadConfig({ DATA_DIR: '   ' })).toThrow(/DATA_DIR/)
  })

  it('decodes the module URL when deriving the built client directory', async () => {
    const parent = await makeTempDataDir()
    const checkout = await mkdir(join(parent, 'checkout with spaces', 'dist', 'server'), {
      recursive: true,
    }).then(() => join(parent, 'checkout with spaces'))
    await writeFile(join(checkout, 'package.json'), '{ "type": "module" }\n')
    const copiedConfig = join(checkout, 'dist', 'server', 'config.ts')
    await copyFile(resolve('src/server/config.ts'), copiedConfig)
    await symlink(resolve('node_modules'), join(checkout, 'node_modules'), 'dir')

    const moduleUrl = pathToFileURL(copiedConfig).href
    const script = `import { loadConfig } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(loadConfig({}).clientDir))`
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      { cwd: checkout },
    )

    expect(JSON.parse(stdout)).toBe(join(checkout, 'dist', 'client'))
  })

  it('defaults the log level to info and accepts an override', () => {
    expect(loadConfig({}).logLevel).toBe('info')
    expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug')
  })

  it('rejects an unknown log level instead of silently logging everything', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/)
  })

  it('allows the shutdown grace period to be tuned for the host platform', () => {
    expect(loadConfig({}).shutdownGraceMs).toBe(10_000)
    expect(loadConfig({ SHUTDOWN_GRACE_MS: '2500' }).shutdownGraceMs).toBe(2500)
  })

  it('carries the setup secret through without judging its strength', () => {
    expect(loadConfig({ SETUP_SECRET: 'a-deployment-setup-secret' }).setupSecret).toBe('a-deployment-setup-secret')
  })

  it('starts without a setup secret, because readiness reports that better than a crash loop', () => {
    expect(loadConfig({}).setupSecret).toBeUndefined()
    expect(loadConfig({ SETUP_SECRET: '' }).setupSecret).toBeUndefined()
  })

  it('believes forwarding headers by default, since the documented deployment is behind a proxy', () => {
    expect(loadConfig({}).trustProxyHeaders).toBe(true)
    expect(loadConfig({ TRUST_PROXY_HEADERS: 'false' }).trustProxyHeaders).toBe(false)
  })

  it('rejects an unrecognised forwarding setting rather than guessing which way it meant', () => {
    expect(() => loadConfig({ TRUST_PROXY_HEADERS: 'yes' })).toThrow(/TRUST_PROXY_HEADERS/)
  })
})
