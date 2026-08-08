import { TabBar } from './components/tab-bar.js'
import { Wordmark } from './components/wordmark.js'
import { useNavigation, type Route } from './routing.js'
import { EmptyView } from './views/empty-view.js'
import { SettingsView } from './views/settings-view.js'

/**
 * The application shell: masthead, the four tabs, and the current view.
 *
 * The structure is identical at every width and on every screen — nothing
 * reflows, reorders, or hides — so only the type scale and padding change.
 */
export function App() {
  const { route, navigate } = useNavigation()

  return (
    <div className="paper">
      <header className="masthead">
        <Wordmark />
        <TabBar active={route} onNavigate={navigate} />
      </header>
      <main>{viewFor(route)}</main>
    </div>
  )
}

function viewFor(route: Route) {
  switch (route) {
    case 'digest':
      return <EmptyView note="nothing yet — subscribe to a feed to start your digest" />
    case 'feeds':
      return <EmptyView note="no subscriptions yet" />
    case 'saved':
      return <EmptyView note="nothing saved yet" />
    case 'settings':
      return <SettingsView />
  }
}
