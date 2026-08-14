import { useState, type ChangeEvent } from 'react'
import type { OpmlImportReport } from '../../shared/api.js'
import { ApiError, importOpml } from '../api.js'

export type OpmlImportOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'imported'; readonly report: OpmlImportReport }
  | { readonly kind: 'failed'; readonly notice: string }

/** Carrying subscriptions in and out: a file to read, a link to leave by. */
export function OpmlControls({ onOutcome }: { onOutcome(outcome: OpmlImportOutcome): void }) {
  const [importing, setImporting] = useState(false)

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Cleared so choosing the same file again fires another change event.
    event.target.value = ''
    if (!file || importing) return

    setImporting(true)
    onOutcome({ kind: 'started' })
    try {
      onOutcome({ kind: 'imported', report: await importOpml(await readFileText(file)) })
    } catch (error) {
      onOutcome({ kind: 'failed', notice: importFailure(error) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="opml-controls">
      <label className="opml-import">
        <span>{importing ? 'importing…' : 'import OPML'}</span>
        <input
          className="opml-file-input"
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml,application/xml"
          disabled={importing}
          onChange={importFile}
        />
      </label>
      <a className="export-link" href="/api/subscriptions/export" download="subscriptions.opml">
        export OPML
      </a>
    </div>
  )
}

export function ImportReport({ report }: { report: OpmlImportReport | undefined }) {
  if (!report) return null
  if (report.added === 0 && report.alreadySubscribed === 0 && report.unusable.length === 0) {
    return <p className="notice import-report-summary">that OPML file lists no feeds</p>
  }

  return (
    <div className="import-report" aria-live="polite">
      <p className="notice import-report-summary">
        {`imported — ${report.added} added, ${report.alreadySubscribed} already subscribed`}
      </p>
      {report.unusable.length > 0 ? (
        <ul className="import-report-details">
          {report.unusable.map((url) => (
            <li key={url}>{url} — not a usable feed url</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read'))
    reader.readAsText(file)
  })
}

const IMPORT_FAILURE_COPY: Readonly<Record<string, string>> = {
  malformed_opml: 'that file is malformed XML',
  unsupported_opml: 'that file is not an OPML subscription list',
  too_many_feeds: 'that file lists more feeds than one import can process',
  invalid_request: 'that file is too large to import',
}

function importFailure(error: unknown): string {
  if (!(error instanceof ApiError)) return 'the reader is unavailable'
  return IMPORT_FAILURE_COPY[error.code] ?? 'that file could not be imported'
}
