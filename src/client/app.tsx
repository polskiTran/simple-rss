import { useRef, useState } from 'react'
import { useArrival } from './arrival.js'
import { useAccess, type Gate } from './authentication.js'
import { BackButton } from './components/back-button.js'
import { ChromeToolbarSlot } from './components/chrome-toolbar.js'
import { GlobalSearch } from './components/global-search.js'
import { SectionNav } from './components/section-nav.js'
import { Wordmark } from './components/wordmark.js'
import { locationAt, originOf, scopeOf, sectionOf, useNavigation, type Navigation } from './routing.js'
import { DigestView } from './views/digest-view.js'
import { FeedView } from './views/feed-view.js'
import { FeedsView } from './views/feeds-view.js'
import { LoginView } from './views/login-view.js'
import { ReaderView } from './views/reader-view.js'
import { SavedView } from './views/saved-view.js'
import { SearchResultsView } from './views/search-results-view.js'
import { SettingsView } from './views/settings-view.js'
import { SetupView } from './views/setup-view.js'

export function App() {
  const navigation = useNavigation()
  const { location } = navigation
  const gate = useAccess()
  const open = gate.access.kind === 'open'
  const back = open && (location.screen === 'feed' || location.screen === 'reader') ? location.origin : undefined
  const page = useRef<HTMLElement>(null)
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  useArrival(navigation.arrival, page)

  return (
    <div className="app" data-screen={open ? location.screen : 'gate'}>
      <header className="chrome">
        {back ? <BackButton className="chrome-back" origin={back} onBack={navigation.returnTo} /> : null}
        <Wordmark onNavigate={open ? () => navigation.navigate('digest') : undefined} />
        {open ? (
          <>
            <SectionNav active={sectionOf(location)} onNavigate={navigation.navigate}>
              <GlobalSearch
                query={location.screen === 'search' ? location.query : ''}
                scope={scopeOf(location)}
                onQueryChange={navigation.updateSearch}
              />
            </SectionNav>
            <div className="chrome-toolbar" ref={setToolbarSlot} />
          </>
        ) : null}
      </header>
      <ChromeToolbarSlot value={toolbarSlot}>
        <main className="page" ref={page}>
          {viewFor(gate, navigation)}
        </main>
      </ChromeToolbarSlot>
    </div>
  )
}

function viewFor(gate: Gate, navigation: Navigation) {
  switch (gate.access.kind) {
    case 'checking':
      return null
    case 'unavailable':
      return (
        <div className="view">
          <p className="note">The reader is unavailable. Try again in a moment.</p>
        </div>
      )
    case 'unclaimed':
      return <SetupView onClaimed={gate.adopt} onAlreadyClaimed={gate.recheck} />
    case 'locked':
      return <LoginView onSignedIn={gate.adopt} />
    case 'open':
      return signedInView(navigation, gate)
  }
}

function signedInView(navigation: Navigation, gate: Gate) {
  const { location } = navigation
  const here = originOf(location)
  const openItem = (feedItemId: number) => navigation.openReader(feedItemId, here)
  const openFeed = (feedId: number) => navigation.openFeed(feedId, here)

  switch (location.screen) {
    case 'digest':
      return (
        <DigestView
          start={location.start}
          onStart={navigation.showDigest}
          onOpenItem={openItem}
          onOpenFeed={openFeed}
        />
      )
    case 'feeds':
      return <FeedsView onOpenFeed={openFeed} />
    case 'saved':
      return <SavedView onOpenItem={openItem} onOpenFeed={openFeed} />
    case 'settings':
      return <SettingsView onAccessChanged={gate.adopt} />
    case 'feed':
      return (
        <FeedView
          feedId={location.feedId}
          origin={location.origin}
          onBack={navigation.returnTo}
          onUnsubscribed={() => navigation.navigate('feeds')}
          onOpenItem={(feedItemId, feedTitle) => navigation.openReader(feedItemId, originOf(location, feedTitle))}
        />
      )
    case 'reader':
      return (
        <ReaderView
          feedItemId={location.feedItemId}
          origin={location.origin}
          onBack={navigation.returnTo}
          // The next item replaces this one, so it keeps this one's way back.
          onOpenItem={(next) => navigation.openReader(next, location.origin)}
          onOpenFeed={openFeed}
        />
      )
    case 'search':
      return (
        <SearchResultsView
          settledQuery={location.query}
          scope={location.scope}
          sort={location.sort}
          onSort={navigation.sortSearch}
          originScope={location.origin ? scopeOf(locationAt(location.origin.path)) : { kind: 'everywhere' }}
          onScope={navigation.searchIn}
          onOpenItem={openItem}
          onOpenFeed={openFeed}
        />
      )
  }
}
