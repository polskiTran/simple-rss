import { useAccess, type Gate } from './authentication.js'
import { TabBar } from './components/tab-bar.js'
import { Wordmark } from './components/wordmark.js'
import { useNavigation, type Route } from './routing.js'
import { DigestView } from './views/digest-view.js'
import { FeedsView } from './views/feeds-view.js'
import { EmptyView } from './views/empty-view.js'
import { LoginView } from './views/login-view.js'
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
  const { route, navigate } = useNavigation()
  const gate = useAccess()

  return (
    <div className="paper">
      <header className="masthead">
        <Wordmark />
        {gate.access.kind === 'open' ? <TabBar active={route} onNavigate={navigate} /> : null}
      </header>
      <main>{viewFor(gate, route)}</main>
    </div>
  )
}

function viewFor(gate: Gate, route: Route) {
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
      return readerViewFor(route, gate)
  }
}

function readerViewFor(route: Route, gate: Gate) {
  switch (route) {
    case 'digest':
      return <DigestView />
    case 'feeds':
      return <FeedsView />
    case 'saved':
      return <EmptyView note="nothing saved yet" />
    case 'settings':
      return <SettingsView onAccessChanged={gate.adopt} />
  }
}
