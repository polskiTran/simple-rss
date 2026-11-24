// Reads the dev database read-only and writes .data/prototype-data.js, which index.html loads.
// The output stays in .data/ so real Feeds never reach git.
// Usage: node docs/design/prototype/export-dev-data.mjs [path/to/simple-rss.db]
import { readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

// micromark comes in through the project's Markdown dependencies; its default output escapes raw HTML.
async function fromStore(name) {
  const store = resolve('node_modules/.pnpm')
  const folder = readdirSync(store).find((entry) => entry.startsWith(`${name}@`))
  return import(pathToFileURL(join(store, folder, 'node_modules', name, 'index.js')).href)
}
const { micromark } = await fromStore('micromark')
const { gfm, gfmHtml } = await fromStore('micromark-extension-gfm')

const databasePath = resolve(process.argv[2] ?? '.data/simple-rss.db')
const outputPath = resolve('.data/prototype-data.js')
const CADENCE_DAYS = 182
const DIGEST_DAYS = 7
const SUMMARY_LENGTH = 280
const ARTICLE_LENGTH = 60_000
const WORDS_PER_MINUTE = 230

const db = new DatabaseSync(databasePath, { readOnly: true })
const { timezone } = db.prepare('SELECT timezone FROM installation_settings').get()

const dayKey = new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: timezone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: timezone,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const now = new Date()
const today = dayKey.format(now)
const since = (days) => new Date(now.getTime() - days * 86_400_000).toISOString()

const INTERVALS = {
  30: 'Every 30 minutes',
  60: 'Every hour',
  120: 'Every 2 hours',
  360: 'Every 6 hours',
  720: 'Every 12 hours',
  1440: 'Every day',
}
const SOURCES = { 'original-webpage': 'Original webpage', 'feed-content': 'Feed Content' }

function ago(iso) {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours ago`
  return `${Math.round(minutes / 1440)} days ago`
}

function availability({ consecutive_failures, last_failure_category, last_success_at }) {
  if (consecutive_failures > 0) return `Failing: ${last_failure_category.replaceAll('_', ' ')}`
  return last_success_at ? 'Available' : 'Unchecked'
}

function host({ home_page_url, domain }) {
  if (!home_page_url) return domain
  try {
    return new URL(home_page_url).hostname.replace(/^www\./u, '')
  } catch {
    return domain
  }
}

function article({ feed_content_markdown: markdown, feed_content_truncated: truncated }) {
  const clipped = markdown.length > ARTICLE_LENGTH
  const source = clipped ? markdown.slice(0, ARTICLE_LENGTH) : markdown
  const words = markdown.split(/\s+/u).length
  return {
    html: micromark(source, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }),
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    truncated: Boolean(truncated) || clipped,
  }
}

const plain = (text) =>
  text
    ?.replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim() || null
const clip = (text) => (text && text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…` : text)

const feeds = db
  .prepare(`
    SELECT f.id, COALESCE(s.custom_title, f.title) AS title, COALESCE(s.custom_description, f.description) AS description,
           f.home_page_url, f.domain, s.polling_interval_minutes, s.reading_source, s.created_at,
           s.last_polled_at, s.last_success_at, s.consecutive_failures, s.last_failure_category
    FROM subscriptions s JOIN feeds f ON f.id = s.feed_id`)
  .all()
  .map((feed) => ({
    id: feed.id,
    title: feed.title,
    home: host(feed),
    description: plain(feed.description),
    interval: INTERVALS[feed.polling_interval_minutes],
    source: SOURCES[feed.reading_source],
    since: longDate.format(new Date(feed.created_at)),
    checked: feed.last_polled_at ? `Checked ${ago(feed.last_polled_at)}` : 'Never checked',
    availability: availability(feed),
  }))

const saved = db
  .prepare('SELECT feed_item_id FROM library_items')
  .all()
  .map((row) => row.feed_item_id)

const recent = since(DIGEST_DAYS + 1)
const rows = db
  .prepare(`
    SELECT i.id, i.feed_id, i.title, i.link, i.published_at, i.chronology_at, i.summary, i.image_url,
           i.discussion_url, i.feed_content_markdown, i.feed_content_truncated
    FROM feed_items i JOIN subscriptions s ON s.feed_id = i.feed_id
    WHERE i.chronology_at > ? ORDER BY i.chronology_at`)
  .all(since(CADENCE_DAYS))
const articles = {}
const items = rows.map((item) => {
  const at = new Date(item.chronology_at)
  const releaseDate = item.published_at?.endsWith('T00:00:00.000Z') && item.chronology_at.endsWith('T12:00:00.000Z')
  const inDigest = item.chronology_at > recent
  if (inDigest && item.feed_content_markdown) articles[item.id] = article(item)
  return [
    item.id,
    item.feed_id,
    dayKey.format(at),
    releaseDate ? null : clock.format(at),
    plain(item.title) ?? 'Untitled',
    item.link,
    inDigest ? clip(plain(item.summary)) : null,
    inDigest ? item.image_url : null,
    inDigest ? item.discussion_url : null,
  ]
})

const data = { today, timezone, exportedAt: now.toISOString(), feeds, saved, items, articles }
writeFileSync(outputPath, `window.DEV_DATA = ${JSON.stringify(data)}\n`)
console.log(
  `${feeds.length} Feeds, ${items.length} Feed Items, ${Object.keys(articles).length} articles, ${saved.length} saved → ${outputPath}`,
)
