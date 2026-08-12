import { useAccess, type Gate } from './authentication.js'
import { TabBar } from './components/tab-bar.js'
import { Wordmark } from './components/wordmark.js'
import {
  DIGEST_ORIGIN,
  FEEDS_ORIGIN,
  SAVED_ORIGIN,
  feedOrigin,
  readerOrigin,
  useNavigation,
  type Navigation,
} from './routing.js'
import { DigestView } from './views/digest-view.js'
import { FeedView } from './views/feed-view.js'
import { FeedsView } from './views/feeds-view.js'
import { EmptyView } from './views/empty-view.js'
import { LoginView } from './views/login-view.js'
import { ReaderView } from './views/reader-view.js'
import { SavedView } from './views/saved-view.js'
import { SettingsView } from './views/settings-view.js'
import { SetupView } from './views/setup-view.js'

/**
 * Application shell. Nothing reflows, reorders, or hides between screens or
 * widths; only type scale and padding change. Tabs render only once access is
 * open — until then all four sections would refuse.
 */
export function App() {
  const navigation = useNavigation()
  const gate = useAccess()

  return (
    <div className="paper">
      <header className="masthead">
        <Wordmark onNavigate={gate.access.kind === 'open' ? () => navigation.navigate('digest') : undefined} />
        {gate.access.kind === 'open' ? <TabBar active={navigation.route} onNavigate={navigation.navigate} /> : null}
      </header>
      <main>{viewFor(gate, navigation)}</main>
    </div>
  )
}

function viewFor(gate: Gate, navigation: Navigation) {
  switch (gate.access.kind) {
    // Deliberately blank: a flash of the wrong screen is worse than a moment of nothing.
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
  // The Reader overlays whichever section opened it, so check it before the tab switch.
  if (navigation.readerItemId !== undefined) {
    const feedItemId = navigation.readerItemId
    const origin = navigation.origin ?? DIGEST_ORIGIN
    return (
      <ReaderView
        feedItemId={feedItemId}
        origin={origin}
        onBack={navigation.returnTo}
        // Reading on keeps the same origin, so the next article exits where this one would.
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

// The shell knows the Feed's id, not its title; FeedView passes the title up
// with each item so the Reader's back link can name the Feed.
function OpenedFeed({ navigation, feedId }: { navigation: Navigation; feedId: number }) {
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
