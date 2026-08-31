/**
 * PROTOTYPE RUNNER — throwaway, never ships.
 *
 * Starts the real service against stubbed upstream feeds, seeds Subscriptions
 * and Feed Items that make the Search jump-to group interesting, and serves the
 * built client. Run `pnpm prototype:search`, open the printed URL, sign in with
 * the printed password, then search "field".
 *
 * Variants live in src/client/views/search-jump-to-prototype.tsx, switchable
 * with the floating bar or `?variant=`.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../src/server/config.js'
import { createLogger } from '../src/server/logger.js'
import { startService } from '../src/server/server.js'
import { createRetrieval } from '../src/server/upstream/retrieval.js'
import { UpstreamFixtures } from '../tests/support/upstream-fixtures.js'

const PORT = 4173
const PASSWORD = 'prototype-password'
const SETUP_SECRET = 'prototype-setup-secret'

const daysAgo = (days: number, hour = 9) => {
  const at = new Date()
  at.setUTCHours(hour, 15, 0, 0)
  return new Date(at.getTime() - days * 86_400_000)
}

const item = (guid: string, title: string, pubDate: Date, summary?: string) => `
  <item>
    <guid isPermaLink="false">${guid}</guid>
    <title>${title}</title>
    <link>https://publisher.example/${guid}</link>
    <pubDate>${pubDate.toUTCString()}</pubDate>
    ${summary ? `<description>${summary}</description>` : ''}
  </item>`

const rss = (title: string, home: string, ...items: string[]) => `<?xml version="1.0"?>
  <rss version="2.0"><channel><title>${title}</title><link>${home}</link>${items.join('')}</channel></rss>`

// Searching "field" should answer with two jump-to entries (title match, plus
// one only the domain matches) above item results drawn from several Feeds.
const FEEDS: readonly { url: string; xml: string }[] = [
  {
    url: 'https://journal.example/feed',
    xml: rss(
      'Field Notes',
      'https://journal.example/',
      item('fn-1', 'A field guide to slow reading', daysAgo(0, 7), 'Why the field guide format survives every medium shift.'),
      item('fn-2', 'Morning chronology', daysAgo(1)),
      item('fn-3', 'The estuary at low tide', daysAgo(3), 'Notes on tidal patterns along the estuary.'),
      item('fn-4', 'What the herons know', daysAgo(6)),
    ),
  },
  {
    url: 'https://fieldrecordings.example/feed',
    xml: rss(
      'The Listening Post',
      'https://fieldrecordings.example/',
      item('lp-1', 'Wind through the pass, recorded at dawn', daysAgo(2), 'A field recording from the high pass, wind and one distant bell.'),
      item('lp-2', 'Rain on a tin roof, 40 minutes', daysAgo(9)),
    ),
  },
  {
    url: 'https://coast.example/feed',
    xml: rss(
      'The Quiet Coast',
      'https://coast.example/',
      item('qc-1', 'Slow water', daysAgo(1, 20), 'Tide notes from the shore, and a field of kelp after the storm.'),
      item('qc-2', 'Driftwood inventory', daysAgo(4)),
    ),
  },
  {
    url: 'https://meadow.example/feed',
    xml: rss(
      'Long Meadow',
      'https://meadow.example/',
      item('lm-1', 'A June letter', daysAgo(5), 'The meadow field trials, continued.'),
      item('lm-2', 'On fences', daysAgo(12)),
    ),
  },
  {
    url: 'https://tabloid.example/feed',
    xml: rss('Tech Tabloid', 'https://tabloid.example/', item('tt-1', 'Release notes, annotated', daysAgo(0, 6))),
  },
]

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'simple-rss-PROTOTYPE-wipe-me-'))
  const upstream = new UpstreamFixtures()
  for (const feed of FEEDS) upstream.stub(feed.url, { headers: { 'content-type': 'application/rss+xml' }, body: feed.xml })

  const config = loadConfig({
    DATA_DIR: dataDir,
    SETUP_SECRET,
    PUBLIC_ORIGIN: `http://localhost:${PORT}`,
    CLIENT_DIR: 'dist/client',
    LOG_LEVEL: 'warn',
  })
  const logger = createLogger({ level: 'warn' })
  const service = await startService({
    config,
    port: PORT,
    logger,
    retrieval: createRetrieval({
      httpClient: upstream.client,
      resolve: upstream.resolve,
      logger,
      self: new URL(config.publicOrigin),
    }),
  })

  const headers = (cookie?: string) => ({
    'content-type': 'application/json',
    origin: service.url,
    ...(cookie ? { cookie } : {}),
  })

  const claimed = await fetch(`${service.url}/api/auth/setup`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ setupSecret: SETUP_SECRET, password: PASSWORD }),
  })
  if (claimed.status !== 201 && claimed.status !== 200) {
    throw new Error(`claim failed: ${claimed.status} ${await claimed.text()}`)
  }
  const cookie = claimed.headers.get('set-cookie')?.split(';')[0]

  for (const feed of FEEDS) {
    const subscribed = await fetch(`${service.url}/api/subscriptions`, {
      method: 'POST',
      headers: headers(cookie),
      body: JSON.stringify({ url: feed.url }),
    })
    if (subscribed.status !== 201) throw new Error(`subscribe failed for ${feed.url}: ${subscribed.status}`)
  }

  // The scheduler polls new Subscriptions on its own; wait until items landed.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const digest = await fetch(`${service.url}/api/digest`, { headers: headers(cookie) })
    const body = (await digest.json()) as { groups?: unknown[] }
    if ((body.groups?.length ?? 0) > 0) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  console.log('')
  console.log('  search jump-to prototype')
  console.log(`  open      ${service.url}`)
  console.log(`  password  ${PASSWORD}`)
  console.log('  then search "field" — flip variants with the bottom bar, ← → keys, or ?variant=A|B|C|D')
  console.log('')
}

void main()
