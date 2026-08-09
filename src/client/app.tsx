import { useAccess, type Gate } from './authentication.js'
import { TabBar } from './components/tab-bar.js'
import { Wordmark } from './components/wordmark.js'
import { useNavigation, type Navigation } from './routing.js'
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
 * The application shell: masthead, the four tabs, and the current view.
 *
 * The structure is identical at every width and on every screen — nothing
 * reflows, reorders, or hides — so only the type scale and padding change.
 *
 * The tabs appear only once the Owner is in. Setup and signing in are not
 * sections of the reader, and navigation to four screens that would all refuse
 * would be furniture pretending to be a way through.
 */
export function App() {
  const navigation = useNavigation()
  const gate = useAccess()

  return (
    <div className="paper">
      <header className="masthead">
        <Wordmark />
        {gate.access.kind === 'open' ? <TabBar active={navigation.route} onNavigate={navigation.navigate} /> : null}
      </header>
      <main>{viewFor(gate, navigation)}</main>
    </div>
  )
}

function viewFor(gate: Gate, navigation: Navigation) {
  switch (gate.access.kind) {
    // Nothing, deliberately: the first answer arrives in a moment, and a flash
    // of the wrong screen is worse than a blank one.
    case 'checking':
      return null
    case 'unavailable':
      return <EmptyView note="the reader is unavailable" />
    case 'unclaimed':
      return <SetupView onClaimed={gate.adopt} onAlreadyClaimed={gate.recheck} />
    case 'locked':
      return <LoginView onSignedIn={gate.adopt} />
    case 'open':
      return readerViewFor(navigation, gate)
  }
}

function readerViewFor(navigation: Navigation, gate: Gate) {
  // An opened Feed Item reads under the Digest tab wherever it was opened
  // from — the Reader belongs to the reading flow it ends by returning to.
  if (navigation.readerItemId !== undefined) {
    return (
      <ReaderView
        feedItemId={navigation.readerItemId}
        onBack={() => navigation.navigate('digest')}
        onOpenItem={navigation.openReader}
      />
    )
  }

  switch (navigation.route) {
    case 'digest':
      return <DigestView onOpenItem={navigation.openReader} />
    case 'feeds':
      return navigation.feedId === undefined ? (
        <FeedsView onOpenFeed={navigation.openFeed} />
      ) : (
        <FeedView
          feedId={navigation.feedId}
          onBack={() => navigation.navigate('feeds')}
          onOpenItem={navigation.openReader}
        />
      )
    case 'saved':
      return <SavedView onOpenItem={navigation.openReader} />
    case 'settings':
      return <SettingsView onAccessChanged={gate.adopt} />
  }
}
