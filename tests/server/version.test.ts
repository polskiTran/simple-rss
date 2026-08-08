import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../../src/shared/version.js'

describe('reported version', () => {
  it('matches the package version, so an upgrade is identifiable', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string
    }

    expect(VERSION).toBe(manifest.version)
  })
})
