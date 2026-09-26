import { useAccess, type Gate } from './authentication.js'
import { BackButton } from './components/back-button.js'
import { GlobalSearch } from './components/global-search.js'
import { SectionNav } from './components/section-nav.js'
import { Wordmark } from './components/wordmark.js'
import {
  DIGEST_ORIGIN,
  FEEDS_ORIGIN,
  SAVED_ORIGIN,
  feedOrigin,
  readerOrigin,
  searchOrigin,
  searchScopeOfScreen,
  useNavigation,
  type Navigation,
  type Origin,
  type ScreenNavigation,
} from './routing.js'
import { DigestView } from './views/digest-view.js'
import { FeedView } from './views/feed-view.js'
import { FeedsView } from './views/feeds-view.js'
import { EmptyView } from './views/empty-view.js'
import { LoginView } from './views/login-view.js'
import { ReaderView } from './views/reader-view.js'
import { SavedView } from './views/saved-view.js'
import { SearchResultsView } from './views/search-results-view.js'
import { SettingsView } from './views/settings-view.js'
import { SetupView } from './views/setup-view.js'

export function App() {
  const navigation = useNavigation()
  const gate = useAccess()
  const open = gate.access.kind === 'open'
  const back = open ? nestedOrigin(navigation) : undefined

  return (
    <div className="app" data-screen={open ? screenOf(navigation) : 'gate'}>
      <header className="chrome">
        {back ? <BackButton className="chrome-back" origin={back} onBack={navigation.returnTo} /> : null}
        <Wordmark onNavigate={open ? () => navigation.navigate('digest') : undefined} />
        {open ? (
          <>
            <GlobalSearch
              query={navigation.kind === 'search' ? navigation.query : ''}
              scope={navigation.searchScope}
              onQueryChange={navigation.updateSearch}
            />
            <SectionNav active={navigation.route} onNavigate={navigation.navigate} />
          </>
        ) : null}
      </header>
      <main className="page">{viewFor(gate, navigation)}</main>
    </div>
  )
}

/** Which chrome a screen takes: a phone hides the tab bar in the Reader and a search, and leads with a back square on nested screens. */
function screenOf(navigation: Navigation): 'search' | 'reader' | 'feed' | 'section' {
  if (navigation.kind === 'search') return 'search'
  if (navigation.readerItemId !== undefined) return 'reader'
  if (navigation.feedId !== undefined) return 'feed'
  return 'section'
}

/** The way back from a nested screen — the one its view and the phone bar both offer. */
function nestedOrigin(navigation: Navigation): Origin | undefined {
  if (navigation.kind === 'search') return undefined
  if (navigation.readerItemId !== undefined) return navigation.origin ?? DIGEST_ORIGIN
  if (navigation.feedId !== undefined) return navigation.origin ?? FEEDS_ORIGIN
  return undefined
}

function viewFor(gate: Gate, navigation: Navigation) {
  switch (gate.access.kind) {
    case 'checking':
      return null
    case 'unavailable':
      return <EmptyView note="the reader is unavailable" />
    case 'unclaimed':
      return <SetupView onClaimed={gate.adopt} onAlreadyClaimed={gate.recheck} />
    case 'locked':
      return <LoginView onSignedIn={gate.adopt} />
    case 'open':
      return signedInView(navigation, gate)
  }
}

function signedInView(navigation: Navigation, gate: Gate) {
  if (navigation.kind === 'search') {
    const origin = searchOrigin(navigation.query, navigation.searchScope, navigation.origin)
    return (
      <SearchResultsView
        settledQuery={navigation.query}
        scope={navigation.searchScope}
        originScope={searchScopeOfScreen(navigation.origin?.path ?? '')}
        onScope={navigation.searchIn}
        onOpenItem={(feedItemId) => navigation.openReader(feedItemId, origin)}
        onOpenFeed={(feedId) => navigation.openFeed(feedId, origin)}
      />
    )
  }

  if (navigation.readerItemId !== undefined) {
    const feedItemId = navigation.readerItemId
    const origin = navigation.origin ?? DIGEST_ORIGIN
    return (
      <ReaderView
        feedItemId={feedItemId}
        origin={origin}
        onBack={navigation.returnTo}
        onOpenItem={(next) => navigation.openReader(next, origin)}
        onOpenFeed={(feedId) => navigation.openFeed(feedId, readerOrigin(feedItemId, navigation.origin))}
      />
    )
  }

  switch (navigation.route) {
    case 'digest':
      return (
        <DigestView
          onOpenItem={(feedItemId) => navigation.openReader(feedItemId, DIGEST_ORIGIN)}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, DIGEST_ORIGIN)}
        />
      )
    case 'feeds':
      return navigation.feedId === undefined ? (
        <FeedsView onOpenFeed={(feedId) => navigation.openFeed(feedId, FEEDS_ORIGIN)} />
      ) : (
        <OpenedFeed navigation={navigation} feedId={navigation.feedId} />
      )
    case 'saved':
      return (
        <SavedView
          onOpenItem={(feedItemId) => navigation.openReader(feedItemId, SAVED_ORIGIN)}
          onOpenFeed={(feedId) => navigation.openFeed(feedId, SAVED_ORIGIN)}
        />
      )
    case 'settings':
      return <SettingsView onAccessChanged={gate.adopt} />
  }
}

function OpenedFeed({ navigation, feedId }: { navigation: ScreenNavigation; feedId: number }) {
  return (
    <FeedView
      feedId={feedId}
      origin={navigation.origin ?? FEEDS_ORIGIN}
      onBack={navigation.returnTo}
      onUnsubscribed={() => navigation.navigate('feeds')}
      onOpenItem={(feedItemId, feedTitle) =>
        navigation.openReader(feedItemId, feedOrigin(feedId, feedTitle, navigation.origin))
      }
    />
  )
}
