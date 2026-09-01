import { useAccess, type Gate } from './authentication.js'
import { GlobalSearch } from './components/global-search.js'
import { TabBar } from './components/tab-bar.js'
import { Wordmark } from './components/wordmark.js'
import {
  DIGEST_ORIGIN,
  FEEDS_ORIGIN,
  SAVED_ORIGIN,
  feedOrigin,
  readerOrigin,
  searchOrigin,
  useNavigation,
  type Navigation,
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

  return (
    <div className="paper">
      <header className="masthead">
        <Wordmark onNavigate={gate.access.kind === 'open' ? () => navigation.navigate('digest') : undefined} />
        {gate.access.kind === 'open' ? (
          <>
            <GlobalSearch
              query={navigation.kind === 'search' ? navigation.query : ''}
              scope={navigation.searchScope}
              onQueryChange={navigation.updateSearch}
            />
            <TabBar active={navigation.route} onNavigate={navigation.navigate} />
          </>
        ) : null}
      </header>
      <main>{viewFor(gate, navigation)}</main>
    </div>
  )
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
    const origin = searchOrigin(navigation.query, navigation.origin)
    return (
      <SearchResultsView
        settledQuery={navigation.query}
        scope={navigation.searchScope}
        onWiden={navigation.widenSearch}
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
