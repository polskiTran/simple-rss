#!/usr/bin/env node
// Drives simple-rss in a real browser for UI verification. See ../SKILL.md.
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCRIPTS = import.meta.dirname
const ROOT = resolve(SCRIPTS, '../../../..')
const EVIDENCE = join(ROOT, '.temp/verify')
const RUN = join(EVIDENCE, '.run')
const PID_FILE = join(RUN, 'vite.pid')
const LOG_FILE = join(RUN, 'vite.log')
const ORIGIN = 'http://127.0.0.1:5199'
const DEV_STORE_KEY = 'break-ui:data'
const MIN_FREE_MB = 1024

const playwright = createRequire(join(ROOT, 'package.json'))('@playwright/test')

/**
 * Widths the session's bugs lived at: both sides of the 1024px break, portrait tablets, a phone, the narrowest phone, 200% zoom.
 * A phone target is a mobile browser: touch, and overlay scrollbars, so `scrollbar-gutter` reserves nothing.
 */
const TARGETS = {
  d1440: { width: 1440, height: 900, scheme: 'light' },
  d1180: { width: 1180, height: 900, scheme: 'light' },
  d1025: { width: 1025, height: 800, scheme: 'dark' },
  t1024: { width: 1024, height: 1366, scheme: 'dark', phone: true },
  t820: { width: 820, height: 1180, scheme: 'light', phone: true },
  p390: { width: 390, height: 844, scheme: 'light', phone: true },
  p320: { width: 320, height: 640, scheme: 'dark', phone: true },
  z200: { width: 640, height: 450, scheme: 'light', scale: 2 },
}

const SCREENS = {
  digest: { path: '/', ready: '.feed-day' },
  feeds: { path: '/feeds', ready: '.feed-row' },
  saved: { path: '/saved', ready: '.item' },
  feed: { path: '/feeds/1', ready: '.item' },
  settings: { path: '/settings', ready: '.page-title' },
  search: { path: '/search?q=hi', ready: '.search-feeds' },
}

/** Screens whose title must share one line; the Feed sits under a Back button, a phone's Digest under its distance. */
const SAME_LINE = {
  wide: ['digest', 'feeds', 'saved', 'settings', 'search'],
  phone: ['feeds', 'saved', 'settings', 'search'],
}

const cadence = (step) => Array.from({ length: 30 }, (_, day) => (day % step === 0 ? (day % 3) + 1 : 0))
const feed = (feedId, title, domain, step) => ({
  feedId,
  title,
  domain,
  homePageUrl: `https://${domain}/`,
  cadence: cadence(step),
})
const hit = (feedItemId, title, feedId, feedTitle, saved) => ({
  feedItemId,
  title,
  feedId,
  feedTitle,
  publishedAt: '2026-10-21T13:36:00Z',
  firstSeenAt: '2026-10-21T13:36:00Z',
  date: '2026-10-21',
  displayTime: '13:36',
  saved,
  snippet: null,
})

/** The dev mock has no search: real names, one long and one unbroken, from Feeds that answer. */
const SEARCH_ANSWER = {
  scope: 'everywhere',
  today: '2026-10-22',
  subscriptions: [
    feed(1, 'ChinAI Newsletter', 'chinai.substack.com', 7),
    feed(2, 'EconTalk Podcast Archive - Econlib', 'www.econlib.org', 5),
    feed(3, 'Stanford Encyclopedia of Philosophy', 'plato.stanford.edu', 2),
    feed(4, 'Statistical Modeling, Causal Inference, and Social Science', 'statmodeling.stat.columbia.edu', 3),
    feed(5, 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz', 'de.example', 11),
  ],
  results: [
    hit(1, 'Hackers hijack Egypt highway billboard and Malaysian screens to show porn', 6, 'Hacker News', false),
    hit(2, 'An Italian farmer found some unknown seeds in his attic and planted them', 6, 'Hacker News', true),
    hit(3, 'Chatbots Are Learning to Think, and This Changes Everything', 7, 'WIRED>ALL', false),
  ],
}

function options(args) {
  const parsed = { params: [] }
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '')
    if (key === 'param') parsed.params.push(args[index + 1])
    else parsed[key] = args[index + 1]
  }
  return parsed
}

function ownVite() {
  if (!existsSync(PID_FILE)) return undefined
  const pid = Number(readFileSync(PID_FILE, 'utf8'))
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('vite.verify.config') ? pid : undefined
  } catch {
    return undefined
  }
}

async function up() {
  const running = ownVite()
  if (running) return console.log(`already up, pid ${running}, ${ORIGIN}`)
  mkdirSync(RUN, { recursive: true })
  const log = openSync(LOG_FILE, 'a')
  const vite = spawn(
    process.execPath,
    [join(ROOT, 'node_modules/vite/bin/vite.js'), '--config', join(SCRIPTS, 'vite.verify.config.mjs')],
    {
      cwd: ROOT,
      detached: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, VERIFY_VITE_CACHE: join(RUN, 'vite-cache') },
    },
  )
  vite.unref()
  writeFileSync(PID_FILE, String(vite.pid))

  for (let wait = 0; wait < 300 && ownVite(); wait += 1) {
    if (await fetch(`${ORIGIN}/`).catch(() => undefined)) break
    await new Promise((done) => setTimeout(done, 100))
  }

  // Ready means a browser can render a screen, not that the port answers. Vite
  // reloads the page once while it optimises dependencies on a cold cache.
  const browser = await playwright.chromium.launch()
  try {
    const page = await browser.newPage()
    await page.addInitScript(([key]) => sessionStorage.setItem(key, 'worst'), [DEV_STORE_KEY])
    await page.goto(`${ORIGIN}/`, { timeout: 60_000 })
    await page.waitForSelector(SCREENS.digest.ready, { timeout: 60_000 })
  } catch (error) {
    console.error(`not ready: ${error.message.split('\n')[0]}`)
    console.error(readFileSync(LOG_FILE, 'utf8').slice(-2000))
    await browser.close()
    await down()
    process.exit(1)
  }
  await browser.close()
  console.log(`ready, pid ${vite.pid}, ${ORIGIN}`)
}

async function down() {
  const pid = ownVite()
  if (pid) {
    process.kill(-pid, 'SIGTERM')
    for (let wait = 0; wait < 50 && ownVite(); wait += 1) await new Promise((done) => setTimeout(done, 100))
  }
  rmSync(RUN, { recursive: true, force: true })
  console.log(`down. evidence kept in ${EVIDENCE}`)
}

async function doctor() {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

  const pid = ownVite()
  check('instance is ours', Boolean(pid), pid ? `pid ${pid}` : 'run: verify.mjs up')
  const entry = await fetch(`${ORIGIN}/main.tsx`).catch(() => undefined)
  check('serves this checkout', entry?.ok === true, ORIGIN)
  const api = await fetch(`${ORIGIN}/api/meta`).catch(() => undefined)
  const json = api?.headers.get('content-type')?.includes('json')
  check('cannot reach a real server', api !== undefined && !json, 'no proxy, so /api answers without JSON')
  const memory = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/)
  const freeMb = memory ? Math.round(Number(memory[1]) / 1024) : 0
  check('memory for a browser', freeMb >= MIN_FREE_MB, `${freeMb}MB available`)

  const installed = readdirSync(join(process.env.HOME, '.cache/ms-playwright')).filter(
    (name) => !name.startsWith('ffmpeg'),
  )
  const dirty = git('status', '--short').split('\n').filter(Boolean).length
  console.log(
    `build   ${git('branch', '--show-current')} ${git('rev-parse', '--short', 'HEAD')}, ${dirty} changed files`,
  )
  console.log(`browser ${installed.join(', ')}`)
  for (const port of [5173, 8080]) {
    const taken = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined)
    if (taken) console.log(`note    ${port} is someone else's instance. Do not drive it.`)
  }
  for (const { name, ok, detail } of checks) console.log(`${ok ? 'ok  ' : 'FAIL'}    ${name}: ${detail}`)
  if (checks.some(({ ok }) => !ok)) process.exit(1)
}

/** Runs in the page. Raw numbers: a rounded measure once hid a title 0.4px off its line. */
function probe() {
  const edge = document.documentElement.clientWidth
  const clipped = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const { overflowX } = getComputedStyle(parent)
      if (overflowX !== 'visible') return true
    }
    return false
  }
  const pastEdge = [...document.querySelectorAll('.chrome *, .page *')]
    .filter((element) => element.getBoundingClientRect().right > edge + 0.5 && !clipped(element))
    .filter((element) => !element.closest('.visually-hidden'))
    .map((element) => `${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`)

  const brokenWords = []
  const read = '.page-title, .group-heading, .feed-row-name, .feed-day-title, .item-title, .item-feed-name, .feed-host'
  for (const block of document.querySelectorAll(read)) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      // An address has no words to protect, so it may break anywhere.
      for (const token of node.textContent.matchAll(/\S+/g)) {
        if (/[/.:@?=]/.test(token[0])) continue
        for (const word of token[0].matchAll(/[\p{Script=Latin}\d’']+/gu)) {
          if (word[0].length < 3 || word[0].length > 24) continue
          const start = token.index + word.index
          const range = document.createRange()
          range.setStart(node, start)
          range.setEnd(node, start + word[0].length)
          const lines = new Set([...range.getClientRects()].filter(({ width }) => width > 0).map(({ top }) => top))
          if (lines.size > 1) brokenWords.push(word[0])
        }
      }
    }
  }

  const title = [...document.querySelectorAll('.page-title')].find((element) => !element.closest('.visually-hidden'))
  const words =
    title && [...title.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
  let line = null
  if (words) {
    const range = document.createRange()
    range.selectNode(words)
    const { fontSize, fontWeight, letterSpacing } = getComputedStyle(title)
    const { top, left } = range.getBoundingClientRect()
    line = { top, left, fontSize, fontWeight, letterSpacing }
  }
  return {
    overflow: document.documentElement.scrollWidth - edge,
    pastEdge: [...new Set(pastEdge)].slice(0, 6),
    brokenWords: [...new Set(brokenWords)].slice(0, 6),
    title: line,
  }
}

function findingsOf(metrics, targetName, screen) {
  const found = []
  const at = `${targetName}/${screen}`
  if (metrics.overflow > 0) found.push(`${at}: scrolls sideways by ${metrics.overflow}px`)
  for (const element of metrics.pastEdge) found.push(`${at}: past the screen edge: ${element}`)
  for (const word of metrics.brokenWords) found.push(`${at}: word broken across lines: ${word}`)
  for (const error of metrics.errors) found.push(`${at}: page error: ${error}`)
  for (const call of metrics.unanswered) found.push(`${at}: no answer for ${call}`)
  return found
}

function titleFindings(results, targetName, width) {
  const screens = SAME_LINE[width > 1024 ? 'wide' : 'phone']
  const lines = screens.filter((screen) => results[screen]?.title).map((screen) => [screen, results[screen].title])
  const [first] = lines
  if (!first) return []
  const found = []
  for (const [screen, line] of lines.slice(1))
    if (JSON.stringify(line) !== JSON.stringify(first[1]))
      found.push(
        `${targetName}: title differs, ${first[0]} ${JSON.stringify(first[1])} against ${screen} ${JSON.stringify(line)}`,
      )
  return found
}

async function sweep(args) {
  const { tag = 'run', data = 'worst', screens, targets, browser: engine = 'chromium', rtl, params } = options(args)
  if (!ownVite()) throw new Error('no instance of ours. Run: verify.mjs up')
  const out = join(EVIDENCE, tag)
  const browser = await playwright[engine].launch()
  const metrics = {}
  const findings = []
  const query = params.length > 0 ? params.join('&') : ''

  for (const targetName of targets?.split(',') ?? Object.keys(TARGETS)) {
    const target = TARGETS[targetName]
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: target.scale ?? 1,
      colorScheme: target.scheme,
      hasTouch: target.phone ?? false,
      isMobile: target.phone ?? false,
      timezoneId: 'UTC',
    })
    await context.addInitScript(([key, chosen]) => sessionStorage.setItem(key, chosen), [DEV_STORE_KEY, data])
    const page = await context.newPage()
    const errors = []
    const unanswered = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/search') return route.fulfill({ json: SEARCH_ANSWER })
      unanswered.push(`${route.request().method()} ${url.pathname}`)
      return route.abort()
    })

    mkdirSync(join(out, targetName), { recursive: true })
    metrics[targetName] = {}
    for (const screen of screens?.split(',') ?? Object.keys(SCREENS)) {
      errors.length = 0
      unanswered.length = 0
      const { path, ready } = SCREENS[screen]
      const joined = query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path
      await page.goto(`${ORIGIN}${joined}`)
      await page.waitForSelector(data === 'empty' ? 'h1' : ready)
      await page.addStyleTag({ content: '[aria-label="Dev data"], .prototype-switcher { display: none !important; }' })
      if (rtl === 'true') await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'))
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: join(out, targetName, `${screen}.png`) })
      const measured = { ...(await page.evaluate(probe)), errors: [...errors], unanswered: [...new Set(unanswered)] }
      metrics[targetName][screen] = measured
      findings.push(...findingsOf(measured, targetName, screen))
    }
    findings.push(...titleFindings(metrics[targetName], targetName, target.width))
    await context.close()
  }
  await browser.close()
  writeFileSync(join(out, 'metrics.json'), JSON.stringify({ data, engine, query, rtl, metrics, findings }, null, 2))
  console.log(`${Object.keys(metrics).length} targets, ${findings.length} findings. evidence: ${out}`)
  for (const finding of findings) console.log(`  ${finding}`)
  if (findings.length > 0) process.exitCode = 1
}

/** One image per tag and screen, side by side. Two identical captures mean the change was not live. */
async function sheet(args) {
  const { tags, target = 'd1180', screens = 'digest,feeds,saved' } = options(args)
  const rows = tags.split(',')
  const columns = screens.split(',')
  const png = (tag, screen) => join(EVIDENCE, tag, target, `${screen}.png`)
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
  for (const screen of columns)
    for (const tag of rows.slice(1))
      if (digest(png(rows[0], screen)) === digest(png(tag, screen)))
        console.log(
          `identical: ${rows[0]} and ${tag} on ${screen}. The change is not live, or does not reach this screen.`,
        )

  const html = join(EVIDENCE, 'sheet.html')
  const cell = (file) => `<img src="${pathToFileURL(file)}" style="width:100%;display:block">`
  const grid = rows
    .map(
      (tag) =>
        `<h2>${tag}</h2><div class="row">${columns.map((screen) => `<div>${cell(png(tag, screen))}</div>`).join('')}</div>`,
    )
    .join('')
  writeFileSync(
    html,
    `<!doctype html><style>body{margin:12px;font:600 16px sans-serif;background:#ddd}h2{margin:12px 0 6px;font-size:16px}
    .row{display:grid;grid-template-columns:repeat(${columns.length},1fr);gap:12px}</style>${grid}`,
  )
  const browser = await playwright.chromium.launch()
  const page = await browser.newPage({ viewport: { width: 640 * columns.length, height: 600 } })
  await page.goto(pathToFileURL(html).href)
  const file = join(EVIDENCE, `sheet-${rows.join('-')}-${target}.png`)
  await page.screenshot({ path: file, fullPage: true })
  await browser.close()
  rmSync(html)
  console.log(file)
}

const [command, ...args] = process.argv.slice(2)
const commands = { up, down, doctor, sweep, sheet }
if (!commands[command]) {
  console.error('usage: verify.mjs up | doctor | sweep | sheet | down')
  process.exit(2)
}
await commands[command](args)
