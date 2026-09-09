import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATABASE_FILE } from '../../../src/server/config.js'
import { openDatabase } from '../../../src/server/persistence/database.js'
import { applyMigrations, migrations } from '../../../src/server/persistence/migrations.js'
import { ManualClock } from '../../support/manual-clock.js'
import { makeTempDataDir } from '../../support/temp-dir.js'
import { digestSchema, readerItemSchema } from '../../../src/shared/api.js'
import { claimedDevice } from '../../support/device.js'
import { startTestService } from '../../support/service-harness.js'

const FEED_URL = 'https://journal.example/feed'
const atom = (fields: string, base = '') =>
  `<feed xmlns="http://www.w3.org/2005/Atom" ${base}><title>Notes</title><entry><id>one</id><title>First light</title><link href="https://journal.example/notes/one"/>${fields}</entry></feed>`
const rss = (fields: string) =>
  `<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Notes</title><item><guid>one</guid><title>First light</title><link>https://journal.example/notes/one</link>${fields}</item></channel></rss>`

async function ingest(document: string) {
  const service = await startTestService()
  service.upstream.stub(FEED_URL, { headers: { 'content-type': 'application/xml' }, body: document })
  const user = await claimedDevice(service)
  expect((await user.post('/api/subscriptions', { url: FEED_URL })).status).toBe(201)
  await service.wakeScheduler()
  const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
  const id = digest.groups[0]?.items[0]?.feedItemId
  if (!id) throw new Error('Feed Item was not ingested')
  const read = async () => readerItemSchema.parse(await (await user.get(`/api/items/${id}`)).json())
  return { service, user, id, read }
}

describe('Feed Content in Reader View', () => {
  it('stores rich content separately from the publisher summary without retrieving the original', async () => {
    const { service, read, user } = await ingest(
      rss(
        `<description>Short preview.</description><content:encoded><![CDATA[<h2>Field methods</h2><p>Observe <em>carefully</em> and <a href="next">continue</a>.</p><ul><li>Arrive early</li></ul>]]></content:encoded>`,
      ),
    )
    const item = await read()
    expect(item.summary).toBe('Short preview.')
    expect(item.feedContent).toMatchObject({ truncated: false, readingTimeMinutes: 1 })
    expect(item.feedContent?.markdown).toContain('## Field methods')
    expect(item.feedContent?.markdown).toContain('*carefully*')
    expect(item.feedContent?.markdown).toContain('[continue](https://journal.example/notes/next)')
    expect(item.feedContent?.markdown).toContain('- Arrive early')
    expect(service.upstream.requestsTo('https://journal.example/notes/one')).toHaveLength(0)
    expect((await (await user.get('/api/search?q=preview')).json()).results).toHaveLength(1)
    expect((await (await user.get('/api/search?q=carefully')).json()).results).toHaveLength(0)
  })
  it.each([
    [
      'empty preferred content',
      rss('<content:encoded> </content:encoded><description>&lt;h2&gt;Description body&lt;/h2&gt;</description>'),
      '## Description body',
    ],
    [
      'active-only preferred content',
      rss(
        '<content:encoded><![CDATA[<script>bad()</script><img src="https://tracker.example/pixel"/>]]></content:encoded><description><![CDATA[<p>A <strong>rich description</strong>.</p>]]></description>',
      ),
      '**rich description**',
    ],
    [
      'literal Atom text',
      atom('<content type="text">&lt;b&gt;literal&lt;/b&gt; &amp;lt;i&amp;gt;</content>'),
      '\\<b>literal\\</b> \\&lt;i\\&gt;',
    ],
    [
      'mixed XML text and CDATA',
      atom('<content type="text">Before <![CDATA[<literal> &amp;]]> after &amp;.</content>'),
      'Before \\<literal> \\&amp; after &.',
    ],
    [
      'Atom HTML',
      atom(
        '<content type="html">&lt;p&gt;A &lt;strong&gt;bright&lt;/strong&gt; &amp;lt;em&amp;gt;literal&amp;lt;/em&amp;gt; &amp;amp; day.&lt;/p&gt;</content>',
      ),
      '**bright** \\<em>literal\\</em> & day.',
    ],
    [
      'Atom XHTML',
      atom(
        '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><h2>XHTML heading</h2><p>A <em>quiet</em> day.</p></div></content>',
      ),
      '## XHTML heading',
    ],
    [
      'prefixed XHTML structure',
      atom(
        '<content type="xhtml"><x:div xmlns:x="http://www.w3.org/1999/xhtml"><x:h2>Prefixed heading</x:h2><x:p>A <x:em>quiet</x:em> day.</x:p></x:div></content>',
      ),
      '## Prefixed heading',
    ],
    [
      'external Atom content',
      atom(
        '<content src="https://remote.example/body" type="text/html"/><summary type="html">&lt;p&gt;Local summary.&lt;/p&gt;</summary>',
      ),
      'Local summary.',
    ],
    [
      'inherited declared base',
      atom(
        '<content type="html">&lt;p&gt;&lt;a href="next"&gt;continue&lt;/a&gt;&lt;/p&gt;</content>',
        'xml:base="https://cdn.example/base/"',
      ),
      '[continue](https://cdn.example/base/next)',
    ],
    [
      'table section bases',
      atom(
        '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><table><tbody xml:base="https://cdn.example/table/"><tr><td><a href="next">continue</a></td></tr></tbody></table></div></content>',
      ),
      '[continue](https://cdn.example/table/next)',
    ],
    [
      'content and child bases',
      atom(
        '<content type="xhtml" xml:base="https://cdn.example/base/"><div xmlns="http://www.w3.org/1999/xhtml" xml:base="child/"><p><a href="next">continue</a></p></div></content>',
      ),
      '[continue](https://cdn.example/base/child/next)',
    ],
  ])('normalizes %s', async (_name, document, expected) => {
    const { read, service } = await ingest(document)
    expect((await read()).feedContent?.markdown).toContain(expected)
    expect(service.upstream.requestsTo('https://remote.example/body')).toHaveLength(0)
  })

  it.each([
    ['content', '<content type="xhtml" xml:base="assets/"><div><a href="next">continue</a></div></content>'],
    ['descendant', '<content type="xhtml"><div xml:base="assets/"><a href="next">continue</a></div></content>'],
    [
      'table section',
      '<content type="xhtml"><div><table><tbody xml:base="assets/"><tr><td><a href="next">continue</a></td></tr></tbody></table></div></content>',
    ],
    [
      'nested declarations',
      '<content type="xhtml" xml:base="assets/child/"><div xml:base="../"><a href="next">continue</a></div></content>',
    ],
  ])('resolves relative %s XML bases against the Feed, not the original page', async (_name, fields) => {
    const { read } = await ingest(atom(fields))
    expect((await read()).feedContent?.markdown).toContain('[continue](https://journal.example/assets/next)')
  })

  it('keeps the original-page fallback outside a descendant XML base', async () => {
    const { read } = await ingest(
      atom(
        '<content type="xhtml"><div><p xml:base="assets/"><a href="next">declared</a></p><p><a href="next">fallback</a></p></div></content>',
      ),
    )
    expect((await read()).feedContent?.markdown).toContain('[declared](https://journal.example/assets/next)')
    expect((await read()).feedContent?.markdown).toContain('[fallback](https://journal.example/notes/next)')
  })

  it('preserves word boundaries across summary line breaks in previews and search', async () => {
    const { read, user } = await ingest(atom('<summary type="html">&lt;p&gt;alpha&lt;br/&gt;beta&lt;/p&gt;</summary>'))
    expect((await read()).summary).toBe('alpha beta')
    const digest = digestSchema.parse(await (await user.get('/api/digest')).json())
    expect(digest.groups[0]?.items[0]?.summary).toBe('alpha beta')
    for (const word of ['alpha', 'beta']) {
      expect((await (await user.get(`/api/search?q=${word}`)).json()).results).toHaveLength(1)
    }
  })

  it('keeps allowed structure and readable rejected links, but no active markup or publisher images', async () => {
    const { read } = await ingest(
      rss(`<description><![CDATA[
      <blockquote><p>A steady hand.</p></blockquote><ol><li>One<ul><li>Nested</li></ul></li></ol>
      <pre><code class="language-js">const light = 1 &lt; 2;</code></pre>
      <table><tr><th>Hour</th><th>Reading</th></tr><tr><td>Morning</td><td>steady | measured</td></tr></table>
      <p><math><semantics><annotation encoding="application/x-tex">e^{i\\pi} = -1</annotation></semantics></math></p>
      <p><a href="javascript:alert(1)">Readable unsafe link</a> <a href="data:text/html,evil">Readable data link</a></p>
      <script>hostile</script><style>evil</style><iframe src="https://tracker.example"></iframe><form>Subscribe now</form><svg><text>SVG payload</text></svg>
      <p onclick="evil()">Safe prose<img src="https://tracker.example/pixel" onerror="evil()"/></p>
    ]]></description>`),
    )
    const content = (await read()).feedContent?.markdown
    expect(content).toContain('> A steady hand.')
    expect(content).toContain('1. One')
    expect(content).toContain('- Nested')
    expect(content).toContain('```js')
    expect(content).toContain('const light = 1 < 2;')
    expect(content).toContain('steady \\| measured')
    expect(content).toContain('$$e^{i\\pi} = -1$$')
    expect(content).toContain('Readable unsafe link')
    expect(content).toContain('Readable data link')
    expect(content).not.toMatch(
      /hostile|evil|Subscribe now|SVG payload|javascript:|data:|tracker.example|<script|<iframe/,
    )
  })

  it.each(['paragraph', 'code', 'list'] as const)(
    'caps an oversized multibyte %s at a closed, readable UTF-8 prefix',
    async (kind) => {
      const long = '朝🌄 '.repeat(60_000)
      const body =
        kind === 'code'
          ? `<pre><code>${long}</code></pre>`
          : kind === 'list'
            ? `<ul><li><strong>${long}</strong></li></ul>`
            : `<p><strong>${long}</strong></p>`
      const { read, service } = await ingest(
        rss(`<content:encoded><![CDATA[${body}<p>Not in the prefix.</p>]]></content:encoded>`),
      )
      const content = (await read()).feedContent
      expect(content?.truncated).toBe(true)
      expect(Buffer.byteLength(content?.markdown ?? '')).toBeLessThanOrEqual(256 * 1024)
      expect(content?.markdown.length).toBeGreaterThan(50_000)
      expect(content?.markdown).not.toContain('Not in the prefix.')
      expect(content?.markdown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u)
      if (kind === 'code') expect(content?.markdown).toMatch(/^```\n[\s\S]*\n```$/)
      else expect(content?.markdown).toMatch(/\*\*$/)
      await service.restart()
      expect((await read()).feedContent).toEqual(content)
    },
  )
})

describe('Feed Content conversion limits', () => {
  it('records a list cut at the node limit even when no later block follows', async () => {
    const { read } = await ingest(rss(`<description><![CDATA[<ul>${'<li>x</li>'.repeat(20_001)}</ul>]]></description>`))
    expect((await read()).feedContent).toMatchObject({ truncated: true })
  })

  it('does not let oversized code-language metadata crowd out a readable body', async () => {
    const { read } = await ingest(
      rss(
        `<description><![CDATA[<pre><code class="language-${'x'.repeat(270_000)}">Readable code.</code></pre>]]></description>`,
      ),
    )
    expect((await read()).feedContent?.markdown).toBe('```\nReadable code.\n```')
  })

  it('bounds expanded destinations while keeping readable link text', async () => {
    const { read } = await ingest(
      atom(
        `<content type="xhtml" xml:base="https://cdn.example/${'long/'.repeat(1_000)}"><div xmlns="http://www.w3.org/1999/xhtml"><p><a href="next">Readable link.</a></p></div></content>`,
      ),
    )
    expect((await read()).feedContent).toMatchObject({ markdown: 'Readable link.', truncated: true })
  })

  it.each([
    ['input', `<p>Readable prefix.</p>${'<!-- padding -->'.repeat(40_000)}<p>Beyond the limit.</p>`],
    ['depth', `<p>Readable prefix.</p>${'<div>'.repeat(100)}<p>Beyond the limit.</p>${'</div>'.repeat(100)}`],
    ['nodes', `<p>Readable prefix.</p>${'<p>x</p>'.repeat(25_000)}<p>Beyond the limit.</p>`],
    [
      'table width',
      `<p>Readable prefix.</p><table><tr>${'<td>x</td>'.repeat(2_000)}</tr></table><p>Beyond the limit.</p>`,
    ],
  ])('bounds %s work without rejecting the Feed Item', async (_limit, body) => {
    const { read } = await ingest(rss(`<content:encoded><![CDATA[${body}]]></content:encoded>`))
    const content = (await read()).feedContent
    expect(content?.truncated).toBe(true)
    expect(content?.markdown).toContain('Readable prefix.')
    expect(content?.markdown).not.toContain('Beyond the limit.')
    expect(Buffer.byteLength(content?.markdown ?? '')).toBeLessThanOrEqual(256 * 1024)
  })
})

describe('Feed Content lifecycle', () => {
  it('updates reappearing Feed Content without changing identity, first-seen time or Library membership', async () => {
    const { read, service, user, id } = await ingest(
      rss('<description>Preview.</description><content:encoded>First body.</content:encoded>'),
    )
    await user.put(`/api/library/${id}`)
    const original = await read()
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/xml' },
      body: rss(
        '<description>Corrected preview.</description><content:encoded><![CDATA[<h2>Corrected body</h2>]]></content:encoded>',
      ),
    })
    service.clock.advance(3 * 60 * 60 * 1000)
    await service.wakeScheduler()
    const corrected = await read()
    expect(corrected.feedItemId).toBe(original.feedItemId)
    expect(corrected.firstSeenAt).toBe(original.firstSeenAt)
    expect(corrected.saved).toBe(true)
    expect(corrected.summary).toBe('Corrected preview.')
    expect(corrected.feedContent?.markdown).toBe('## Corrected body')
    await service.restart()
    expect((await read()).feedContent).toEqual(corrected.feedContent)
    expect(service.upstream.requestsTo('https://journal.example/notes/one')).toHaveLength(0)
  })

  it.each([false, true])(
    'retains Feed Content outside the Feed Window until Retention judges its Feed Item (saved=%s)',
    async (saved) => {
      const { read, service, user, id } = await ingest(
        rss('<description><![CDATA[<p>A <strong>durable</strong> body.</p>]]></description>'),
      )
      if (saved) await user.put(`/api/library/${id}`)
      const original = (await read()).feedContent
      service.upstream.stub(FEED_URL, {
        headers: { 'content-type': 'application/xml' },
        body: '<rss><channel><title>Notes</title></channel></rss>',
      })
      service.clock.advance(3 * 60 * 60 * 1000)
      await service.wakeScheduler()
      expect((await read()).feedContent).toEqual(original)
      service.clock.advance(91 * 24 * 60 * 60 * 1000)
      await service.wakeScheduler()
      expect((await user.signIn()).status).toBe(200)
      expect((await user.get(`/api/items/${id}`)).status).toBe(saved ? 200 : 404)
      if (saved) {
        expect((await read()).feedContent).toEqual(original)
        await user.delete(`/api/feeds/${(await read()).feedId}`)
        await service.wakeScheduler()
        expect((await read()).feedContent).toEqual(original)
        await user.delete(`/api/library/${id}`)
        await service.wakeScheduler()
        expect((await user.get(`/api/items/${id}`)).status).toBe(404)
      }
    },
  )

  it('migrates old Feed Items without fetching or inventing Feed Content, including on 304', async () => {
    const dataDir = await makeTempDataDir()
    const clock = new ManualClock()
    const old = openDatabase(join(dataDir, DATABASE_FILE))
    applyMigrations(
      old,
      clock,
      migrations.filter((migration) => migration.version < 14),
    )
    old.$client.exec(`
      INSERT INTO feeds (id, entered_url, resolved_url, title, domain, etag, created_at, updated_at)
      VALUES (7, 'https://journal.example/feed', 'https://journal.example/feed', 'Notes', 'journal.example', '"unchanged"', '2026-08-08T09:00:00.000Z', '2026-08-08T09:00:00.000Z');
      INSERT INTO subscriptions (feed_id, created_at) VALUES (7, '2026-08-08T09:00:00.000Z');
      INSERT INTO feed_items (id, feed_id, dedupe_key, identity_kind, title, link, summary, first_seen_at, last_observed_at)
      VALUES (12, 7, 'guid:one', 'guid', 'First light', 'https://journal.example/notes/one', 'Existing summary.', '2026-08-08T09:00:00.000Z', '2026-08-08T09:00:00.000Z');
      INSERT INTO library_items (feed_item_id, saved_at) VALUES (12, '2026-08-08T09:00:00.000Z');
    `)
    old.$client.close()
    const service = await startTestService({ dataDir, clock })
    const user = await claimedDevice(service)
    const readOld = async () => readerItemSchema.parse(await (await user.get('/api/items/12')).json())
    const original = await readOld()
    expect(original).toMatchObject({
      feedItemId: 12,
      summary: 'Existing summary.',
      firstSeenAt: '2026-08-08T09:00:00.000Z',
      saved: true,
      feedContent: null,
    })
    expect(service.upstream.requestsTo(FEED_URL)).toHaveLength(0)
    expect((await service.fetch('/api/items/12')).status).toBe(401)
    service.upstream.stub(FEED_URL, { status: 304, headers: { etag: '"unchanged"' } })
    await service.wakeScheduler()
    expect((await readOld()).feedContent).toBeNull()
    expect((await readOld()).summary).toBe('Existing summary.')
    expect(service.upstream.requestsTo(FEED_URL)).toHaveLength(1)
    expect(service.upstream.requestsTo(FEED_URL)[0]?.headers['if-none-match']).toBe('"unchanged"')
    service.upstream.stub(FEED_URL, {
      headers: { 'content-type': 'application/xml' },
      body: rss('<description>New Feed Content.</description>'),
    })
    clock.advance(3 * 60 * 60 * 1000)
    await service.wakeScheduler()
    expect(await readOld()).toMatchObject({
      feedItemId: 12,
      saved: true,
      firstSeenAt: original.firstSeenAt,
      feedContent: { markdown: 'New Feed Content.' },
    })
  })
})
