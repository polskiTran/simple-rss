import { Button } from '@base-ui/react/button'
import { useState } from 'react'
import type { AuthStatus } from '../../shared/api.js'
import { signOut } from '../api.js'
import { AppearanceChoice } from './settings/appearance-choice.js'
import { PasswordChange } from './settings/password-change.js'
import { TimezoneChoice } from './settings/timezone-choice.js'
import { VersionNote } from './settings/version-note.js'

export interface SettingsViewProps {
  onAccessChanged(status: AuthStatus): void
}

/** The sheet: unrelated preferences, one row each, none of them the reading shape. */
export function SettingsView({ onAccessChanged }: SettingsViewProps) {
  const [changing, setChanging] = useState(false)

  async function leave() {
    try {
      await signOut()
    } finally {
      onAccessChanged({ claimed: true, authenticated: false })
    }
  }

  return (
    <div className="view measure">
      <dl className="sheet">
        <dt className="sheet-label">timezone</dt>
        <dd className="sheet-value">
          <TimezoneChoice />
        </dd>

        <dt className="sheet-label">appearance</dt>
        <dd className="sheet-value">
          <AppearanceChoice />
        </dd>

        <dt className="sheet-label">version</dt>
        <dd className="sheet-value">
          <VersionNote />
        </dd>

        <dt className="sheet-label">export</dt>
        <dd className="sheet-value">
          <span className="export-links">
            <a className="export-link" href="/api/subscriptions/export" download="subscriptions.opml">
              subscriptions (OPML)
            </a>
            <a className="export-link" href="/api/export" download="simple-rss-export.json">
              everything (JSON)
            </a>
          </span>
        </dd>

        <dt className="sheet-label">password</dt>
        <dd className="sheet-value">
          <Button className="text-button" onClick={() => setChanging(!changing)}>
            {changing ? 'cancel' : 'change'}
          </Button>
        </dd>

        <dt className="sheet-label">session</dt>
        <dd className="sheet-value">
          <Button className="text-button" onClick={leave}>
            sign out
          </Button>
        </dd>
      </dl>

      {changing ? <PasswordChange onChanged={onAccessChanged} /> : null}
    </div>
  )
}
