import { describe, expect, it, vi } from 'vitest'
import { validateDestination, type ResolveAddresses } from '../../../src/server/upstream/destination.js'

/** A resolver that answers from a table and refuses anything it has not been told about. */
function resolver(table: Record<string, readonly string[]>): ResolveAddresses {
  return async (hostname) => table[hostname] ?? []
}

const publicResolver = resolver({ 'example.com': ['93.184.216.34'] })

describe('validateDestination', () => {
  it('accepts a public HTTPS destination and reports what it resolved to', async () => {
    const verdict = await validateDestination('https://example.com/feed.xml', { resolve: publicResolver })

    expect(verdict).toMatchObject({ ok: true, addresses: ['93.184.216.34'] })
    expect(verdict.ok && verdict.url.href).toBe('https://example.com/feed.xml')
  })

  it('accepts plain HTTP, which many Feeds still publish over', async () => {
    await expect(
      validateDestination('http://example.com/feed.xml', { resolve: publicResolver }),
    ).resolves.toMatchObject({ ok: true })
  })

  it.each(['ftp://example.com/feed.xml', 'file:///etc/passwd', 'data:text/plain,hello', 'gopher://example.com'])(
    'refuses the non-HTTP destination %s',
    async (candidate) => {
      await expect(validateDestination(candidate, { resolve: publicResolver })).resolves.toMatchObject({
        ok: false,
        code: 'blocked_destination',
      })
    },
  )

  it.each(['not a url', 'example.com/feed.xml', '', '///'])('refuses the malformed URL %j', async (candidate) => {
    await expect(validateDestination(candidate, { resolve: publicResolver })).resolves.toMatchObject({
      ok: false,
      code: 'invalid_url',
    })
  })

  it('refuses credentials embedded in the URL without repeating them in the reason', async () => {
    const verdict = await validateDestination('https://owner:hunter2@example.com/feed.xml', {
      resolve: publicResolver,
    })

    expect(verdict).toMatchObject({ ok: false, code: 'blocked_destination' })
    expect(verdict.ok ? '' : verdict.reason).not.toContain('hunter2')
  })

  it.each([
    'http://localhost/feed.xml',
    'http://LOCALHOST:8080/feed.xml',
    'http://api.localhost/feed.xml',
    'http://printer.local/feed.xml',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://db.home.arpa/feed.xml',
  ])('refuses the local-network name %s without asking the resolver', async (candidate) => {
    const resolve = vi.fn<ResolveAddresses>(async () => ['93.184.216.34'])

    await expect(validateDestination(candidate, { resolve })).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    'http://127.0.0.1:8080/feed.xml',
    'http://10.0.0.5/feed.xml',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/feed.xml',
    'http://[::ffff:127.0.0.1]/feed.xml',
    'http://0.0.0.0/feed.xml',
  ])('refuses the address literal %s without asking the resolver', async (candidate) => {
    const resolve = vi.fn<ResolveAddresses>(async () => ['93.184.216.34'])

    await expect(validateDestination(candidate, { resolve })).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses a name that resolves to a private address', async () => {
    await expect(
      validateDestination('https://intranet.example.com/feed.xml', {
        resolve: resolver({ 'intranet.example.com': ['192.168.1.10'] }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination' })
  })

  it('refuses a name that answers with one public and one private address', async () => {
    await expect(
      validateDestination('https://mixed.example.com/feed.xml', {
        resolve: resolver({ 'mixed.example.com': ['93.184.216.34', '127.0.0.1'] }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination' })
  })

  it('refuses a decimal or shorthand host by the address the resolver gives it', async () => {
    await expect(
      validateDestination('http://2130706433/feed.xml', {
        resolve: resolver({ '2130706433': ['127.0.0.1'] }),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination' })
  })

  it('reports a name nothing answers for separately from a blocked one', async () => {
    await expect(
      validateDestination('https://gone.example.com/feed.xml', { resolve: resolver({}) }),
    ).resolves.toMatchObject({ ok: false, code: 'unresolvable_host' })
  })

  it('reports a resolver failure as an unresolvable host rather than throwing', async () => {
    await expect(
      validateDestination('https://gone.example.com/feed.xml', {
        resolve: async () => {
          throw new Error('ENOTFOUND')
        },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'unresolvable_host' })
  })

  it('refuses the installation asking itself for a page', async () => {
    const policy = {
      resolve: resolver({ 'reader.example.com': ['93.184.216.34'] }),
      self: ['https://reader.example.com'],
    }

    await expect(validateDestination('https://reader.example.com/api/meta', policy)).resolves.toMatchObject({
      ok: false,
      code: 'blocked_destination',
    })
    await expect(
      validateDestination('https://READER.example.com:443/api/meta', policy),
    ).resolves.toMatchObject({ ok: false, code: 'blocked_destination' })
  })

  it('lets a different port on the same host through, which is a different service', async () => {
    await expect(
      validateDestination('https://reader.example.com:8443/feed.xml', {
        resolve: resolver({ 'reader.example.com': ['93.184.216.34'] }),
        self: ['https://reader.example.com'],
      }),
    ).resolves.toMatchObject({ ok: true })
  })

  it('asks the resolver for the hostname exactly as the URL normalised it', async () => {
    const resolve = vi.fn<ResolveAddresses>(async () => ['93.184.216.34'])

    await validateDestination('https://EXAMPLE.com/feed.xml', { resolve })

    expect(resolve).toHaveBeenCalledWith('example.com')
  })
})
