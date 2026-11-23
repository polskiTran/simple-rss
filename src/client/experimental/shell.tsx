import { type ReactNode, use, useMemo, useRef, useState } from 'react'
import { RHYTHM_LABELS, RHYTHMS, rhythmOf } from '../../shared/rhythm.js'
import { APPEARANCE_OPTIONS, type Appearance, chooseAppearance, storedAppearance } from '../appearance.js'
import { fetchSubscriptions } from '../api.js'
import { useArrival } from '../arrival.js'
import { ReportSaveFailure } from '../components/save-failure.js'
import { feedPath, type Navigation, originOf, scopeOf, sectionPath } from '../routing.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { useResource, valueInView } from '../use-resource.js'
import { ArmSlots, Bloom, BloomState } from './bloom.js'
import { DigestScreen } from './digest-screen.js'
import { FeedScreen } from './feed-screen.js'
import { ArmHeading, ArmLink, Options, SubscriptionsContext } from './parts.js'
import { ReaderScreen } from './reader-screen.js'

interface ExperimentalShellProps {
  readonly navigation: Navigation
  readonly fallback: ReactNode
}

export function ExperimentalShell({ navigation, fallback }: ExperimentalShellProps) {
  const { location } = navigation
  const here = originOf(location).path
  const [open, setOpen] = useState(false)
  const [openAt, setOpenAt] = useState(here)
  if (openAt !== here) {
    setOpenAt(here)
    setOpen(false)
  }

  const [subscriptions, { retry: reloadSubscriptions }] = useResource('subscriptions', fetchSubscriptions)
  const list = valueInView(subscriptions)?.subscriptions
  const settled = subscriptions.kind !== 'loading' || list !== undefined
  const rhythms = useMemo(
    () => (settled ? new Map((list ?? []).map((feed) => [feed.feedId, rhythmOf(feed.cadence)])) : undefined),
    [list, settled],
  )

  const [east, setEast] = useState<HTMLElement | null>(null)
  const [south, setSouth] = useState<HTMLElement | null>(null)
  const [west, setWest] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ e: east, s: south, w: west }), [east, south, west])
  const bloom = useMemo(() => ({ open, close: () => setOpen(false) }), [open])

  const page = useRef<HTMLElement>(null)
  useArrival(navigation.arrival, page)
  const [saveFailure, setSaveFailure] = useState<string>()

  const screen = designedScreen(navigation)

  return (
    <SubscriptionsContext value={{ list, rhythms }}>
      <BloomState value={bloom}>
        <ArmSlots value={slots}>
          <ReportSaveFailure value={setSaveFailure}>
            <div className="x-shell" data-bloom={open ? 'open' : undefined}>
              {screen ? (
                <main className="x x-page" ref={page}>
                  {saveFailure ? (
                    <p className="x-grid x-notice" role="status">
                      <span className="x-c-main">
                        {saveFailure}{' '}
                        <button type="button" className="x-more" onClick={() => setSaveFailure(undefined)}>
                          Dismiss
                        </button>
                      </span>
                    </p>
                  ) : null}
                  {screen}
                </main>
              ) : (
                fallback
              )}
              <Bloom
                open={open}
                ownsSlash={screen !== null}
                onOpenChange={(next) => {
                  setOpen(next)
                  if (next) reloadSubscriptions()
                }}
                panels={{
                  n: <GoArm navigation={navigation} />,
                  e: (
                    <>
                      <SearchBox key={here} navigation={navigation} />
                      <div ref={setEast} className="x-arm-slot" />
                    </>
                  ),
                  s: <div ref={setSouth} className="x-arm-slot" />,
                  w: (
                    <>
                      <div ref={setWest} className="x-arm-slot x-arm-rows" />
                      <ThemeOptions />
                    </>
                  ),
                }}
              />
            </div>
          </ReportSaveFailure>
        </ArmSlots>
      </BloomState>
    </SubscriptionsContext>
  )
}

function designedScreen(navigation: Navigation): ReactNode | null {
  const { location } = navigation
  const here = originOf(location)
  switch (location.screen) {
    case 'digest':
      return (
        <DigestScreen
          start={location.start}
          onStart={navigation.showDigest}
          onOpenItem={(feedItemId) => navigation.openReader(feedItemId, here)}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, here)}
          onAddFeed={() => navigation.navigate('feeds')}
        />
      )
    case 'feed':
      return (
        <FeedScreen
          key={location.feedId}
          feedId={location.feedId}
          onOpenItem={(feedItemId, feedTitle) => navigation.openReader(feedItemId, originOf(location, feedTitle))}
        />
      )
    case 'reader':
      return (
        <ReaderScreen
          feedItemId={location.feedItemId}
          origin={location.origin}
          onBack={navigation.returnTo}
          onStep={navigation.stepReader}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, here)}
        />
      )
    default:
      return null
  }
}

const PLACES = [
  { route: 'digest', label: 'Digest' },
  { route: 'feeds', label: 'Feeds' },
  { route: 'saved', label: 'Library' },
  { route: 'settings', label: 'Settings' },
] as const

function GoArm({ navigation }: { readonly navigation: Navigation }) {
  const { location } = navigation
  return (
    <div className="x-go">
      <div>
        <ArmHeading>Go</ArmHeading>
        {PLACES.map(({ route, label }) => (
          <ArmLink
            key={route}
            href={sectionPath(route)}
            current={location.screen === route}
            onNavigate={() => navigation.navigate(route)}
          >
            {label}
          </ArmLink>
        ))}
      </div>
      <GoFeeds navigation={navigation} />
    </div>
  )
}

function GoFeeds({ navigation }: { readonly navigation: Navigation }) {
  const { location } = navigation
  const { list } = use(SubscriptionsContext)
  const tiers = RHYTHMS.flatMap((rhythm) => {
    const members = (list ?? [])
      .filter((feed) => rhythmOf(feed.cadence) === rhythm)
      .toSorted((left, right) => left.title.localeCompare(right.title))
    return members.length > 0 ? [{ rhythm, members }] : []
  })
  return (
    <div className="x-go-feeds">
      {tiers.map(({ rhythm, members }) => (
        <div key={rhythm}>
          <ArmHeading end={members.length.toLocaleString('en-GB')}>{RHYTHM_LABELS[rhythm]}</ArmHeading>
          {members.map((feed) => (
            <ArmLink
              key={feed.feedId}
              href={feedPath(feed.feedId)}
              current={location.screen === 'feed' && location.feedId === feed.feedId}
              onNavigate={() => navigation.openFeed(feed.feedId, originOf(location))}
            >
              {feed.title}
            </ArmLink>
          ))}
        </div>
      ))}
    </div>
  )
}

function SearchBox({ navigation }: { readonly navigation: Navigation }) {
  const { location } = navigation
  const [draft, setDraft] = useState(location.screen === 'search' ? location.query : '')
  const { prompt } = SEARCH_SCOPE_COPY[scopeOf(location).kind]
  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim() !== '') navigation.updateSearch(draft)
      }}
    >
      <input
        className="x-search"
        type="search"
        aria-label={prompt}
        placeholder={prompt}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </form>
  )
}

const APPEARANCE_LABELS = { system: 'System', light: 'Light', dark: 'Dark' } as const satisfies Record<
  Appearance,
  string
>

function ThemeOptions() {
  const [appearance, setAppearance] = useState(storedAppearance)
  return (
    <div className="x-arm-rows">
      <ArmHeading>Theme</ArmHeading>
      <Options
        label="Theme"
        options={APPEARANCE_OPTIONS.map((option) => ({ value: option, label: APPEARANCE_LABELS[option] }))}
        value={appearance}
        onChange={(option) => {
          chooseAppearance(option)
          setAppearance(option)
        }}
      />
    </div>
  )
}
