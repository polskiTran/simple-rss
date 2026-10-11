// PROTOTYPE — throwaway, lives on `prototype/subscribe-flow` only (#92).
// Takes on the subscribe flow, switched by `?variant=` on /feeds:
//   D One field — the recommendation after review; see VariantD.
//   A Steps — the dialog walks address → choose a Feed → preview.
//   B Live  — one column; results grow under the field, the chosen Feed expands in place.
//   C Wide  — the dialog widens into declared Feeds beside the Feed's own screen in small.
// Lookups are stubbed: the address typed picks the case (the bar lists them). Nothing is recorded.

import { Button } from '@base-ui/react/button'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ActionDialog, DialogCancel } from '../components/action-dialog.js'
import { CadenceStrip } from '../components/cadence-strip.js'
import { Field } from '../components/field.js'
import { Icon } from '../components/icon.js'
import { LoadingNote } from '../components/loading-note.js'
import { PrototypeSwitcher } from '../components/prototype-switcher.js'
import { feedAddressOf } from './feed-language.js'
import './add-feed-prototype.css'

// ---------------------------------------------------------------- stub lookup

interface StubItem {
  readonly title: string
  readonly daysAgo: number
}

interface StubFeed {
  readonly url: string
  readonly title: string
  readonly description: string
  readonly host: string
  readonly cadence: readonly number[]
  readonly items: readonly StubItem[]
  readonly subscribed: boolean
}

interface Declared {
  readonly url: string
  readonly title: string
}

type Lookup =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'feed'; readonly feed: StubFeed }
  | { readonly kind: 'page'; readonly host: string; readonly declared: readonly Declared[] }
  | { readonly kind: 'none'; readonly host: string }
  | { readonly kind: 'unreachable'; readonly host: string }

const SCENARIOS = [
  ['lowtechmagazine.com', 'a page naming 3 Feeds'],
  ['single.example', 'a page naming 1 Feed'],
  ['example.com/feed.xml', 'a Feed'],
  ['stale.example/rss', 'a Feed silent for 2 years'],
  ['already.example/feed', 'a Feed you follow'],
  ['plain.example', 'a page naming no Feed'],
  ['down.example', 'a site that doesn’t answer'],
] as const

const FRESH = [
  'How solar-powered websites survive the winter',
  'A short history of the pneumatic tube, and why it might come back to the office',
  'Why old tractors are worth more than new ones',
  'The return of the clothes line',
  'Heat the person, not the house',
]
const COMMENTS = [
  'Comment on “The return of the clothes line”',
  'Comment on “Heat the person, not the house”',
  'Comment on “Why old tractors are worth more than new ones”',
  'Comment on “The return of the clothes line”',
  'Comment on “How solar-powered websites survive the winter”',
]
const OLD = [
  'Episode 41: Windmills of the Low Countries',
  'Episode 40: Sailing cargo ships',
  'Episode 39: The fireless cooker',
  'Episode 38: Bicycle-powered machines',
  'Episode 37: Ropeways',
]

function stubFeed(url: string, kind: 'fresh' | 'comments' | 'stale', subscribed = false): StubFeed {
  const host = new URL(url).host
  const days = kind === 'stale' ? [731, 760, 802, 845, 880] : kind === 'comments' ? [0, 0, 1, 2, 2] : [0, 3, 5, 9, 14]
  const titles = kind === 'stale' ? OLD : kind === 'comments' ? COMMENTS : FRESH
  return {
    url,
    host,
    subscribed,
    title: kind === 'stale' ? 'Low-tech Radio' : kind === 'comments' ? 'Comments — Low-tech Magazine' : 'Low-tech Magazine',
    description:
      kind === 'stale'
        ? 'Conversations about technologies that keep working.'
        : 'Doubts on progress and technology, published on a solar-powered server.',
    cadence: Array.from({ length: 30 }, (_, day) =>
      kind === 'stale' ? 0 : kind === 'comments' ? (day * 7) % 5 : [3, 9, 14, 21, 27].includes(day) ? 1 : 0,
    ),
    items: titles.map((title, index) => ({ title, daysAgo: days[index] ?? 0 })),
  }
}

/** Stands in for the preview endpoint: one Retrieval, nothing stored. */
async function lookUp(address: string): Promise<Lookup> {
  await new Promise((resolve) => setTimeout(resolve, 900))
  const url = feedAddressOf(address)
  if (!url) return { kind: 'invalid' }
  const host = new URL(url).host
  if (url.includes('down')) return { kind: 'unreachable', host }
  if (url.includes('plain')) return { kind: 'none', host }
  if (url.includes('already')) return { kind: 'feed', feed: stubFeed(url, 'fresh', true) }
  if (url.includes('stale')) return { kind: 'feed', feed: stubFeed(url, 'stale') }
  if (url.includes('comments')) return { kind: 'feed', feed: stubFeed(url, 'comments') }
  if (/feed|rss|atom|\.xml/.test(url)) return { kind: 'feed', feed: stubFeed(url, 'fresh') }
  if (url.includes('single')) return { kind: 'page', host, declared: [{ url: `https://${host}/feed.xml`, title: 'Posts' }] }
  return {
    kind: 'page',
    host,
    declared: [
      { url: `https://${host}/feed.xml`, title: 'Low-tech Magazine' },
      { url: `https://${host}/comments/feed`, title: 'Comments' },
      { url: `https://${host}/radio/stale.rss`, title: 'Low-tech Radio' },
    ],
  }
}

async function subscribeStub(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 700))
}

// ------------------------------------------------------------- shared wording

const TODAY = new Date('2026-10-11T12:00:00')
const STALE_AFTER_DAYS = 90

function ago(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 45) return `${days} days ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  const years = Math.round(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

function shortDate(daysAgo: number): string {
  const date = new Date(TODAY.getTime() - daysAgo * 86_400_000)
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === TODAY.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function lastItem(feed: StubFeed): number {
  return feed.items[0]?.daysAgo ?? Number.POSITIVE_INFINITY
}

function rhythm(feed: StubFeed): string {
  const total = feed.cadence.reduce((sum, count) => sum + count, 0)
  return total >= 20 ? 'Daily' : total >= 4 ? 'Weekly' : total >= 1 ? 'Monthly' : 'Inactive'
}

function failure(lookup: Lookup): string | undefined {
  switch (lookup.kind) {
    case 'invalid':
      return 'Enter a site or feed address, like lowtechmagazine.com.'
    case 'none':
      return `${lookup.host} doesn’t name a feed. Try the feed’s own address.`
    case 'unreachable':
      return `${lookup.host} didn’t answer. Nothing was added.`
    default:
      return undefined
  }
}

interface VariantProps {
  onSubscribed(feed: StubFeed): void
}

const TRIGGER = (
  <Button className="button button-primary">
    <Icon name="plus" />
    Add feed
  </Button>
)

// ------------------------------------------------------------------ A: Steps

type StepA =
  | { readonly step: 'address' }
  | { readonly step: 'choose'; readonly host: string; readonly declared: readonly Declared[] }
  | { readonly step: 'preview'; readonly feed: StubFeed; readonly back: StepA }

function VariantA({ onSubscribed }: VariantProps) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [step, setStep] = useState<StepA>({ step: 'address' })
  const [error, setError] = useState<{ text: string; retry: boolean } | undefined>(undefined)
  const [busy, setBusy] = useState<string | undefined>(undefined)

  function openChanged(next: boolean) {
    setOpen(next)
    if (next) {
      setAddress('')
      setStep({ step: 'address' })
      setError(undefined)
    }
  }

  async function find(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setBusy('address')
    const lookup = await lookUp(address)
    setBusy(undefined)
    const text = failure(lookup)
    if (text) return setError({ text, retry: lookup.kind === 'unreachable' })
    if (lookup.kind === 'feed') return setStep({ step: 'preview', feed: lookup.feed, back: { step: 'address' } })
    if (lookup.kind !== 'page') return
    const choose: StepA = { step: 'choose', host: lookup.host, declared: lookup.declared }
    if (lookup.declared.length === 1 && lookup.declared[0]) return pick(lookup.declared[0].url, { step: 'address' })
    setStep(choose)
  }

  async function pick(url: string, back: StepA) {
    setBusy(url)
    const lookup = await lookUp(url)
    setBusy(undefined)
    if (lookup.kind === 'feed') setStep({ step: 'preview', feed: lookup.feed, back })
  }

  async function subscribe(feed: StubFeed) {
    setBusy('subscribe')
    await subscribeStub()
    setBusy(undefined)
    setOpen(false)
    onSubscribed(feed)
  }

  return (
    <ActionDialog open={open} title="Add feed" trigger={TRIGGER} onOpenChange={openChanged}>
      {step.step === 'address' ? (
        <form className="dialog-body" onSubmit={find}>
          <Field
            label="URL"
            type="url"
            value={address}
            placeholder="https://"
            autoComplete="off"
            autoFocus
            note="A site address is enough; simple finds its feeds."
            error={error?.text}
            onChange={setAddress}
          />
          {busy === 'address' ? <LoadingNote announce>Looking for feeds</LoadingNote> : null}
          <div className="dialog-footer">
            <DialogCancel />
            <Button
              className="button button-primary"
              type="submit"
              focusableWhenDisabled
              disabled={address.trim() === '' || busy !== undefined}
            >
              {busy ? 'Looking…' : error?.retry ? 'Retry' : 'Find feed'}
            </Button>
          </div>
        </form>
      ) : step.step === 'choose' ? (
        <div className="dialog-body">
          <p className="proto-lede">
            {step.host} names {step.declared.length} feeds. Pick one to see what it publishes.
          </p>
          <ul className="proto-choices">
            {step.declared.map((declared) => (
              <li key={declared.url}>
                <button
                  type="button"
                  className="proto-choice"
                  disabled={busy !== undefined}
                  onClick={() => void pick(declared.url, step)}
                >
                  <span className="proto-choice-title">{declared.title}</span>
                  <span className="note">{busy === declared.url ? 'Loading…' : declared.url.replace('https://', '')}</span>
                  <Icon name="chevron-right" />
                </button>
              </li>
            ))}
          </ul>
          <div className="dialog-footer proto-footer-split">
            <Button className="button" onClick={() => setStep({ step: 'address' })}>
              <Icon name="arrow-left" />
              Back
            </Button>
            <DialogCancel />
          </div>
        </div>
      ) : (
        <div className="dialog-body">
          <PreviewA feed={step.feed} />
          <div className="dialog-footer proto-footer-split">
            <Button className="button" onClick={() => setStep(step.back)}>
              <Icon name="arrow-left" />
              Back
            </Button>
            <span className="proto-footer-end">
              <DialogCancel />
              <Button
                className="button button-primary"
                focusableWhenDisabled
                disabled={step.feed.subscribed || busy !== undefined}
                onClick={() => void subscribe(step.feed)}
              >
                {step.feed.subscribed ? 'Subscribed' : busy === 'subscribe' ? 'Subscribing…' : 'Subscribe'}
              </Button>
            </span>
          </div>
        </div>
      )}
    </ActionDialog>
  )
}

/** The confirmation: recency leads, the items prove it. */
function PreviewA({ feed }: { feed: StubFeed }) {
  const last = lastItem(feed)
  const stale = last > STALE_AFTER_DAYS
  return (
    <div className="proto-preview">
      <div className="feed-row-head">
        <h3 className="feed-row-name">{feed.title}</h3>
        <CadenceStrip counts={feed.cadence} title={feed.title} />
      </div>
      <span className="feed-host">{feed.url.replace('https://', '')}</span>
      <p className="proto-recency">
        Last item {ago(last)}
        {stale ? <span className="proto-recency-note">It may have stopped publishing.</span> : null}
      </p>
      {feed.subscribed ? <p className="note">You already follow this feed.</p> : null}
      <ol className="proto-items">
        {feed.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: prototype stub list.
          <li key={index} className="proto-item">
            <span className="proto-item-title">{item.title}</span>
            <span className="proto-item-when">{shortDate(item.daysAgo)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------- B: Live

function VariantB({ onSubscribed }: VariantProps) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [result, setResult] = useState<Lookup | undefined>(undefined)
  const [looking, setLooking] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [feeds, setFeeds] = useState<ReadonlyMap<string, StubFeed>>(new Map())
  const [subscribing, setSubscribing] = useState(false)
  const latest = useRef(0)

  function openChanged(next: boolean) {
    setOpen(next)
    if (next) {
      setAddress('')
      setResult(undefined)
      setSelected(undefined)
      setFeeds(new Map())
    }
  }

  async function find(line: string) {
    const ticket = ++latest.current
    setLooking(true)
    setResult(undefined)
    const lookup = await lookUp(line)
    if (ticket !== latest.current) return
    setLooking(false)
    setResult(lookup)
    if (lookup.kind === 'feed') {
      setFeeds(new Map([[lookup.feed.url, lookup.feed]]))
      setSelected(lookup.feed.url)
    }
    if (lookup.kind === 'page' && lookup.declared[0]) void choose(lookup.declared[0].url)
  }

  async function choose(url: string) {
    setSelected(url)
    if (feeds.has(url)) return
    const lookup = await lookUp(url)
    if (lookup.kind === 'feed') setFeeds((known) => new Map(known).set(url, lookup.feed))
  }

  // Looks the address up once typing pauses on something that could be one.
  useEffect(() => {
    if (!feedAddressOf(address)) return
    const timer = window.setTimeout(() => void find(address), 700)
    return () => window.clearTimeout(timer)
  }, [address])

  const chosen = selected ? feeds.get(selected) : undefined
  const error = result ? failure(result) : undefined

  return (
    <ActionDialog open={open} title="Add feed" trigger={TRIGGER} onOpenChange={openChanged}>
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault()
          void find(address)
        }}
      >
        <Field
          label="URL"
          type="url"
          value={address}
          placeholder="https://"
          autoComplete="off"
          autoFocus
          note="A site address is enough; simple finds its feeds."
          error={error}
          onChange={setAddress}
        />
        <div aria-live="polite" className="proto-live">
          {looking ? <LoadingNote>Looking for feeds</LoadingNote> : null}
          {result?.kind === 'page' && result.declared.length > 1 ? (
            <p className="proto-lede">
              {result.host} names {result.declared.length} feeds.
            </p>
          ) : null}
          {result?.kind === 'page' ? (
            <div className="proto-accordion" role="radiogroup" aria-label="Feeds on this site">
              {result.declared.map((declared) => {
                const isSelected = declared.url === selected
                const feed = feeds.get(declared.url)
                return (
                  <div key={declared.url} className="proto-option" data-selected={isSelected || undefined}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className="proto-option-head"
                      onClick={() => void choose(declared.url)}
                    >
                      <span className="proto-radio" aria-hidden="true" />
                      <span className="proto-choice-title">{declared.title}</span>
                      <span className="note">{declared.url.replace('https://', '')}</span>
                    </button>
                    {isSelected ? (
                      feed ? (
                        <PreviewB feed={feed} />
                      ) : (
                        <LoadingNote className="proto-option-wait">Reading the feed</LoadingNote>
                      )
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
          {result?.kind === 'feed' && chosen ? (
            <div className="proto-option" data-selected>
              <div className="proto-option-head proto-option-static">
                <span className="proto-choice-title">{chosen.title}</span>
              </div>
              <PreviewB feed={chosen} />
            </div>
          ) : null}
        </div>
        <div className="dialog-footer">
          <DialogCancel />
          {result?.kind === 'unreachable' ? (
            <Button className="button button-primary" onClick={() => void find(address)}>
              Retry
            </Button>
          ) : (
            <Button
              className="button button-primary"
              focusableWhenDisabled
              disabled={!chosen || chosen.subscribed || subscribing}
              onClick={async () => {
                if (!chosen) return
                setSubscribing(true)
                await subscribeStub()
                setSubscribing(false)
                setOpen(false)
                onSubscribed(chosen)
              }}
            >
              {chosen?.subscribed ? 'Subscribed' : subscribing ? 'Subscribing…' : 'Subscribe'}
            </Button>
          )}
        </div>
      </form>
    </ActionDialog>
  )
}

function PreviewB({ feed }: { feed: StubFeed }) {
  const last = lastItem(feed)
  const stale = last > STALE_AFTER_DAYS
  return (
    <div className="proto-option-body">
      <p className="proto-meta-line">
        <span className={stale ? 'proto-stale' : undefined}>Last item {ago(last)}</span>
        <span aria-hidden="true">·</span>
        <span>{rhythm(feed)}</span>
        <CadenceStrip counts={feed.cadence} title={feed.title} />
      </p>
      {stale ? <p className="note">Nothing new in {ago(last).replace(' ago', '')}. It may have stopped publishing.</p> : null}
      {feed.subscribed ? <p className="note">You already follow this feed.</p> : null}
      <ol className="proto-items proto-items-tight">
        {feed.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: prototype stub list.
          <li key={index} className="proto-item">
            <span className="proto-item-title">{item.title}</span>
            <span className="proto-item-when">{shortDate(item.daysAgo)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------- C: Wide

function VariantC({ onSubscribed }: VariantProps) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [error, setError] = useState<{ text: string; retry: boolean } | undefined>(undefined)
  const [looking, setLooking] = useState(false)
  const [found, setFound] = useState<{ host: string; declared: readonly Declared[] } | undefined>(undefined)
  const [current, setCurrent] = useState<StubFeed | undefined>(undefined)
  const [reading, setReading] = useState<string | undefined>(undefined)
  const [subscribing, setSubscribing] = useState(false)

  function openChanged(next: boolean) {
    setOpen(next)
    if (next) {
      setAddress('')
      setError(undefined)
      setFound(undefined)
      setCurrent(undefined)
    }
  }

  async function find(event: FormEvent) {
    event.preventDefault()
    setError(undefined)
    setLooking(true)
    const lookup = await lookUp(address)
    setLooking(false)
    const text = failure(lookup)
    if (text) return setError({ text, retry: lookup.kind === 'unreachable' })
    if (lookup.kind === 'feed') {
      setFound({ host: lookup.feed.host, declared: [{ url: lookup.feed.url, title: lookup.feed.title }] })
      setCurrent(lookup.feed)
    }
    if (lookup.kind === 'page') {
      setFound({ host: lookup.host, declared: lookup.declared })
      if (lookup.declared[0]) void read(lookup.declared[0].url)
    }
  }

  async function read(url: string) {
    setReading(url)
    const lookup = await lookUp(url)
    setReading(undefined)
    if (lookup.kind === 'feed') setCurrent(lookup.feed)
  }

  if (!found) {
    return (
      <ActionDialog open={open} title="Add feed" trigger={TRIGGER} onOpenChange={openChanged}>
        <form className="dialog-body" onSubmit={find}>
          <Field
            label="URL"
            type="url"
            value={address}
            placeholder="https://"
            autoComplete="off"
            autoFocus
            note="A site address is enough; simple finds its feeds."
            error={error?.text}
            onChange={setAddress}
          />
          {looking ? <LoadingNote announce>Looking for feeds</LoadingNote> : null}
          <div className="dialog-footer">
            <DialogCancel />
            <Button
              className="button button-primary"
              type="submit"
              focusableWhenDisabled
              disabled={address.trim() === '' || looking}
            >
              {looking ? 'Looking…' : error?.retry ? 'Retry' : 'Find feed'}
            </Button>
          </div>
        </form>
      </ActionDialog>
    )
  }

  const several = found.declared.length > 1
  return (
    <ActionDialog open={open} title={`Feeds on ${found.host}`} trigger={TRIGGER} onOpenChange={openChanged}>
      <div className="proto-wide" data-single={several ? undefined : true}>
        {several ? (
          <nav className="proto-rail" aria-label="Feeds on this site">
            {found.declared.map((declared) => (
              <button
                key={declared.url}
                type="button"
                className="button proto-rail-item"
                aria-current={current?.url === declared.url || undefined}
                onClick={() => void read(declared.url)}
              >
                {declared.title}
              </button>
            ))}
          </nav>
        ) : null}
        <section className="proto-sheet">
          {reading || !current ? <LoadingNote>Reading the feed</LoadingNote> : <PreviewC feed={current} />}
        </section>
      </div>
      <div className="dialog-footer proto-footer-split">
        <Button className="button" onClick={() => setFound(undefined)}>
          <Icon name="arrow-left" />
          Change address
        </Button>
        <span className="proto-footer-end">
          <DialogCancel />
          <Button
            className="button button-primary"
            focusableWhenDisabled
            disabled={!current || current.subscribed || reading !== undefined || subscribing}
            onClick={async () => {
              if (!current) return
              setSubscribing(true)
              await subscribeStub()
              setSubscribing(false)
              setOpen(false)
              onSubscribed(current)
            }}
          >
            {current?.subscribed ? 'Subscribed' : subscribing ? 'Subscribing…' : 'Subscribe'}
          </Button>
        </span>
      </div>
    </ActionDialog>
  )
}

/** The Feed's own screen in small: name, the facts that decide, then what it publishes. */
function PreviewC({ feed }: { feed: StubFeed }) {
  const last = lastItem(feed)
  const stale = last > STALE_AFTER_DAYS
  const total = feed.cadence.reduce((sum, count) => sum + count, 0)
  return (
    <div className="proto-feed">
      <h3 className="proto-feed-name">{feed.title}</h3>
      <p className="proto-feed-description">{feed.description}</p>
      <span className="feed-host">{feed.url.replace('https://', '')}</span>
      <dl className="rows proto-facts">
        <div className="row">
          <dt className="row-label">Last item</dt>
          <dd className={stale ? 'row-value proto-stale' : 'row-value'}>
            {ago(last)}
            {stale ? ' — may have stopped' : ''}
          </dd>
        </div>
        <div className="row">
          <dt className="row-label">Last 30 days</dt>
          <dd className="row-value proto-facts-cadence">
            <CadenceStrip counts={feed.cadence} title={feed.title} />
            {total} items · {rhythm(feed)}
          </dd>
        </div>
        {feed.subscribed ? (
          <div className="row">
            <dt className="row-label">Subscription</dt>
            <dd className="row-value">You already follow it</dd>
          </div>
        ) : null}
      </dl>
      <ol className="proto-boxes">
        {feed.items.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: prototype stub list.
          <li key={index} className="proto-box">
            <span className="proto-box-when">{shortDate(item.daysAgo)}</span>
            <span className="proto-box-title">{item.title}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------- D: One field
// The field is the anchor and never moves. Whatever the address turns out to be
// arrives under it as Feeds that already show the decision — how alive each is —
// so choosing is comparing, not drilling in. One Feed is open at a time.

type Found =
  | { readonly kind: 'feeds'; readonly host: string | undefined; readonly feeds: readonly StubFeed[] }
  | { readonly kind: 'failed'; readonly text: string; readonly retry: boolean }

/** Stands in for one preview call: a page's declared Feeds come back already summarised. */
async function discover(address: string): Promise<Found> {
  const lookup = await lookUp(address)
  const text = failure(lookup)
  if (text) return { kind: 'failed', text, retry: lookup.kind === 'unreachable' }
  if (lookup.kind === 'feed') return { kind: 'feeds', host: undefined, feeds: [lookup.feed] }
  if (lookup.kind !== 'page') return { kind: 'failed', text: 'That address couldn’t be read.', retry: true }
  const feeds = await Promise.all(lookup.declared.map(async (declared) => lookUp(declared.url)))
  return {
    kind: 'feeds',
    host: lookup.host,
    feeds: feeds.flatMap((found) => (found.kind === 'feed' ? [found.feed] : [])),
  }
}

function VariantD({ onSubscribed }: VariantProps) {
  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [found, setFound] = useState<Found | undefined>(undefined)
  const [looking, setLooking] = useState(false)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [subscribing, setSubscribing] = useState(false)
  const latest = useRef(0)

  function openChanged(next: boolean) {
    if (subscribing) return
    setOpen(next)
    if (next) {
      latest.current++
      setAddress('')
      setFound(undefined)
      setLooking(false)
      setSelected(undefined)
    }
  }

  async function look(line: string) {
    if (!feedAddressOf(line)) return
    const ticket = ++latest.current
    setLooking(true)
    const next = await discover(line)
    if (ticket !== latest.current) return
    setLooking(false)
    setFound(next)
    setSelected(next.kind === 'feeds' ? next.feeds[0]?.url : undefined)
  }

  // A paste looks up at once; typing waits for a pause.
  function changed(next: string) {
    const pasted = next.length - address.length > 1
    setAddress(next)
    setFound(undefined)
    if (pasted) void look(next)
  }

  useEffect(() => {
    if (found || looking || !feedAddressOf(address)) return
    const timer = window.setTimeout(() => void look(address), 800)
    return () => window.clearTimeout(timer)
  }, [address])

  const feeds = found?.kind === 'feeds' ? found.feeds : []
  const chosen = feeds.find((feed) => feed.url === selected)
  const failed = found?.kind === 'failed' ? found : undefined

  async function subscribe() {
    if (!chosen) return
    setSubscribing(true)
    await subscribeStub()
    setSubscribing(false)
    setOpen(false)
    onSubscribed(chosen)
  }

  return (
    <ActionDialog open={open} title="Add feed" trigger={TRIGGER} onOpenChange={openChanged}>
      <form
        className="dialog-body d-body"
        onSubmit={(event) => {
          event.preventDefault()
          if (chosen && !chosen.subscribed) void subscribe()
          else void look(address)
        }}
      >
        <Field
          label="Site or feed address"
          type="url"
          value={address}
          placeholder="lowtechmagazine.com"
          autoComplete="off"
          autoFocus
          note={found || looking ? undefined : 'A site’s own address is enough.'}
          error={failed?.text}
          onChange={changed}
        />

        <div className="d-result" aria-live="polite">
          {looking ? <LoadingNote>{`Reading ${hostOf(address)}`}</LoadingNote> : null}
          {!looking && feeds.length > 1 && found?.kind === 'feeds' ? (
            <p className="d-lede">
              {found.host} names {feeds.length} feeds. Choose one.
            </p>
          ) : null}
          {!looking && feeds.length > 0 ? (
            <div className="d-feeds" role={feeds.length > 1 ? 'radiogroup' : undefined} aria-label="Feeds found">
              {feeds.map((feed) => (
                <FeedChoice
                  key={feed.url}
                  feed={feed}
                  single={feeds.length === 1}
                  selected={feed.url === selected}
                  onSelect={() => setSelected(feed.url)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className="dialog-footer">
          <DialogCancel disabled={subscribing} />
          {failed?.retry ? (
            <Button className="button button-primary" onClick={() => void look(address)}>
              Retry
            </Button>
          ) : (
            <Button
              className="button button-primary"
              type="submit"
              focusableWhenDisabled
              disabled={!chosen || chosen.subscribed || subscribing}
            >
              {chosen?.subscribed ? 'Already subscribed' : subscribing ? 'Subscribing…' : 'Subscribe'}
            </Button>
          )}
        </div>
      </form>
    </ActionDialog>
  )
}

function hostOf(address: string): string {
  const url = feedAddressOf(address)
  return url ? new URL(url).host : address
}

/** One Feed as a choice: its pulse always shown, its latest titles once chosen. */
function FeedChoice({
  feed,
  single,
  selected,
  onSelect,
}: {
  feed: StubFeed
  single: boolean
  selected: boolean
  onSelect(): void
}) {
  const last = lastItem(feed)
  const stale = last > STALE_AFTER_DAYS
  const head = (
    <>
      <span className="d-feed-name">{feed.title}</span>
      <CadenceStrip counts={feed.cadence} title={feed.title} />
      <span className="d-feed-pulse">
        <span className={stale ? 'd-stale' : undefined}>Last item {ago(last)}</span>
        <span aria-hidden="true"> · </span>
        {rhythm(feed)}
        {feed.subscribed ? (
          <>
            <span aria-hidden="true"> · </span>
            <span className="d-stale">You follow this</span>
          </>
        ) : null}
      </span>
    </>
  )

  return (
    <div className="d-feed" data-selected={selected || undefined} data-single={single || undefined}>
      {single ? (
        <div className="d-feed-head">{head}</div>
      ) : (
        <button type="button" role="radio" aria-checked={selected} className="d-feed-head" onClick={onSelect}>
          {head}
        </button>
      )}
      {selected ? (
        <div className="d-feed-detail">
          {stale ? (
            <p className="d-warning">Nothing new in {ago(last).replace(' ago', '')}. It may have stopped publishing.</p>
          ) : null}
          <ol className="d-titles">
            {feed.items.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: prototype stub list.
              <li key={index} className="d-title">
                <span className="d-title-text">{item.title}</span>
                <span className="d-title-when">{shortDate(item.daysAgo)}</span>
              </li>
            ))}
          </ol>
          <p className="d-address">{feed.url.replace('https://', '')}</p>
        </div>
      ) : null}
    </div>
  )
}

// --------------------------------------------------------------- the switch

const VARIANTS = [
  { key: 'D', name: 'One field' },
  { key: 'A', name: 'Steps' },
  { key: 'B', name: 'Live' },
  { key: 'C', name: 'Wide' },
] as const

/** Mounted in place of Add feed on /feeds in development builds. */
export function AddFeedPrototype() {
  const [variant, setVariant] = useState(() => new URLSearchParams(window.location.search).get('variant') ?? 'D')
  const [event, setEvent] = useState('')

  function switchTo(key: string) {
    const url = new URL(window.location.href)
    url.searchParams.set('variant', key)
    window.history.replaceState(window.history.state, '', url)
    setVariant(key)
  }

  function subscribed(feed: StubFeed) {
    setEvent(`Stub: subscribed to ${feed.title} (${feed.url.replace('https://', '')})`)
  }

  return (
    <>
      {variant === 'B' ? (
        <VariantB key="B" onSubscribed={subscribed} />
      ) : variant === 'C' ? (
        <VariantC key="C" onSubscribed={subscribed} />
      ) : variant === 'A' ? (
        <VariantA key="A" onSubscribed={subscribed} />
      ) : (
        <VariantD key="D" onSubscribed={subscribed} />
      )}
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={switchTo}>
        <details className="proto-cases">
          <summary>Addresses to try</summary>
          <ul>
            {SCENARIOS.map(([address, what]) => (
              <li key={address}>
                <code>{address}</code> {what}
              </li>
            ))}
          </ul>
        </details>
        {event ? <p className="proto-event">{event}</p> : null}
      </PrototypeSwitcher>
    </>
  )
}
