import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import type { AuthStatus } from '../../shared/api.js'
import { rhythmOf } from '../../shared/rhythm.js'
import { fetchSubscriptions } from '../api.js'
import { useArrival } from '../arrival.js'
import { editable } from '../editable.js'
import { RoutedLink } from '../components/routed-link.js'
import { ReportSaveFailure } from '../components/save-failure.js'
import {
  locationAt,
  type Navigation,
  originOf,
  ROUTE_LABELS,
  type Route,
  scopeOf,
  sectionOf,
  sectionPath,
} from '../routing.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { useResource, valueInView } from '../use-resource.js'
import { DigestScreen } from './digest-screen.js'
import { FeedScreen } from './feed-screen.js'
import { FeedsScreen } from './feeds-screen.js'
import { LibraryScreen } from './library-screen.js'
import { SubscriptionsContext } from './parts.js'
import { ReaderScreen } from './reader-screen.js'
import { SearchScreen } from './search-screen.js'
import { SettingsScreen } from './settings-screen.js'

interface ShellProps {
  readonly navigation: Navigation
  onAccessChanged(status: AuthStatus): void
}

export function Shell({ navigation, onAccessChanged }: ShellProps) {
  const [subscriptions, { retry: reloadSubscriptions }] = useResource('subscriptions', fetchSubscriptions)
  const list = valueInView(subscriptions)?.subscriptions
  const settled = subscriptions.kind !== 'loading' || list !== undefined
  const rhythms = useMemo(
    () => (settled ? new Map((list ?? []).map((feed) => [feed.feedId, rhythmOf(feed.cadence)])) : undefined),
    [list, settled],
  )

  const page = useRef<HTMLElement>(null)
  useArrival(navigation.arrival, page)
  const [saveFailure, setSaveFailure] = useState<string>()

  const screen = screenFor(navigation, { onSubscriptionsChanged: reloadSubscriptions, onAccessChanged })

  return (
    <SubscriptionsContext value={{ list, rhythms }}>
      <ReportSaveFailure value={setSaveFailure}>
        <div className="x x-page">
          <TopBar navigation={navigation} />
          <main ref={page}>
            {saveFailure ? (
              <p className="x-grid x-notice x-save-failure" role="status">
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
        </div>
      </ReportSaveFailure>
    </SubscriptionsContext>
  )
}

interface ShellActions {
  onSubscriptionsChanged(): void
  onAccessChanged(status: AuthStatus): void
}

function screenFor(navigation: Navigation, actions: ShellActions): ReactNode {
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
    case 'saved':
      return (
        <LibraryScreen
          onOpenItem={(feedItemId) => navigation.openReader(feedItemId, here)}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, here)}
        />
      )
    case 'feeds':
      return (
        <FeedsScreen
          onOpenFeed={(feedId) => navigation.openFeed(feedId, here)}
          onSubscribed={(feedId) => {
            actions.onSubscriptionsChanged()
            navigation.openFeed(feedId, here)
          }}
          onReload={actions.onSubscriptionsChanged}
        />
      )
    case 'feed':
      return (
        <FeedScreen
          key={location.feedId}
          feedId={location.feedId}
          origin={location.origin}
          onBack={navigation.returnTo}
          onOpenItem={(feedItemId, feedTitle) => navigation.openReader(feedItemId, originOf(location, feedTitle))}
          onRenamed={actions.onSubscriptionsChanged}
          onUnsubscribed={() => {
            actions.onSubscriptionsChanged()
            navigation.navigate('feeds')
          }}
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
    case 'settings':
      return <SettingsScreen onAccessChanged={actions.onAccessChanged} />
    case 'search':
      return (
        <SearchScreen
          query={location.query}
          scope={location.scope}
          sort={location.sort}
          originScope={location.origin ? scopeOf(locationAt(location.origin.path)) : { kind: 'everywhere' }}
          onScope={navigation.searchIn}
          onSort={navigation.sortSearch}
          onOpenItem={(feedItemId) => navigation.openReader(feedItemId, here)}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, here)}
        />
      )
  }
}

const PLACES = ['digest', 'saved', 'feeds'] as const satisfies readonly Route[]

function TopBar({ navigation }: { readonly navigation: Navigation }) {
  const { location } = navigation
  const section = sectionOf(location)
  const place = (route: Route) => (
    <RoutedLink
      className="x-place"
      href={sectionPath(route)}
      aria-current={section === route ? 'page' : undefined}
      onNavigate={() => navigation.navigate(route)}
    >
      {ROUTE_LABELS[route]}
    </RoutedLink>
  )
  return (
    <header className="x-grid x-top">
      <nav className="x-c-label x-places" aria-label="Places">
        {PLACES.map((route) => (
          <span key={route}>{place(route)}</span>
        ))}
      </nav>
      <SearchLine key={originOf(location).path} navigation={navigation} />
      <div className="x-c-end x-top-end">{place('settings')}</div>
    </header>
  )
}

function SearchLine({ navigation }: { readonly navigation: Navigation }) {
  const { location } = navigation
  const [draft, setDraft] = useState(location.screen === 'search' ? location.query : '')
  const field = useRef<HTMLInputElement>(null)
  const { prompt } = SEARCH_SCOPE_COPY[scopeOf(location).kind]

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return
      if (editable(event.target)) return
      event.preventDefault()
      field.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  return (
    <form
      className="x-c-main"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.trim() !== '') navigation.updateSearch(draft)
      }}
    >
      <input
        ref={field}
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
