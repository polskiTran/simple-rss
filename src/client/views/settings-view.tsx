import { Button } from '@base-ui/react/button'
import type { ReactNode } from 'react'
import { useScreenTitle } from '../arrival.js'
import type { AuthStatus } from '../../shared/api.js'
import { signOut } from '../api.js'
import { Group } from '../components/group.js'
import { Icon } from '../components/icon.js'
import { AppearanceChoice } from './settings/appearance-choice.js'
import { PasswordChange } from './settings/password-change.js'
import { TimezoneChoice } from './settings/timezone-choice.js'
import { VersionNote } from './settings/version-note.js'

interface SettingsViewProps {
  onAccessChanged(status: AuthStatus): void
}

export function SettingsView({ onAccessChanged }: SettingsViewProps) {
  useScreenTitle('Settings')
  async function leave() {
    try {
      await signOut()
    } finally {
      onAccessChanged({ claimed: true, authenticated: false })
    }
  }

  return (
    <div className="view settings-view">
      <header className="page-head">
        <h1 className="page-title">Settings</h1>
      </header>

      <Group id="settings-reading" title="Reading" className="panel">
        <Setting label="Timezone" note="Decides where one day ends in the digest.">
          <TimezoneChoice />
        </Setting>
        <Setting label="Appearance" note="On this device only.">
          <AppearanceChoice />
        </Setting>
      </Group>

      <Group id="settings-data" title="Your data" className="panel">
        <Setting label="Export" note="OPML moves your feeds to another reader. JSON includes your saved items.">
          <div className="toolbar-group">
            <a className="button" href="/api/subscriptions/export" download="subscriptions.opml">
              <Icon name="download" />
              Subscriptions (OPML)
            </a>
            <a className="button" href="/api/export" download="simple-rss-export.json">
              <Icon name="download" />
              Everything (JSON)
            </a>
          </div>
        </Setting>
      </Group>

      <Group id="settings-account" title="Account" className="panel">
        <Setting label="Password">
          <PasswordChange onChanged={onAccessChanged} />
        </Setting>
        <Setting label="Session">
          <Button className="button" onClick={leave}>
            Sign out
          </Button>
        </Setting>
      </Group>

      <p className="note settings-version">
        simple <VersionNote />
      </p>
    </div>
  )
}

/** One preference: what it is and does on the left, its control on the right. */
function Setting({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-label">
        <p className="setting-name">{label}</p>
        {note ? <p className="note">{note}</p> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}
