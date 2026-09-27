import { Field as BaseField } from '@base-ui/react/field'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { MAX_SEARCH_QUERY_LENGTH, type SearchScope } from '../../shared/api.js'
import { SEARCH_SCOPE_COPY } from '../search-scope.js'
import { Icon } from './icon.js'

interface GlobalSearchProps {
  query: string
  scope: SearchScope
  onQueryChange(query: string): void
}

/**
 * How long typing rests before the draft becomes the query. Commits are what
 * write history and fetch results, so the pause also keeps the line under
 * Safari's history-write throttle, which throws past ~100 writes in 30s.
 */
const SETTLE_MS = 250

/**
 * The header's search field. A phone shows it only once its search square is
 * pressed or a search is under way; `data-open` says so, and the close square
 * clears the words and leaves.
 */
export function GlobalSearch({ query, scope, onQueryChange }: GlobalSearchProps) {
  const input = useRef<HTMLInputElement>(null)
  const [opened, setOpened] = useState(false)

  const [draft, setDraft] = useState(query)
  const [settled, setSettled] = useState(query)
  if (query !== settled) {
    setSettled(query)
    setDraft(query)
  }

  const commit = useEffectEvent(onQueryChange)
  useEffect(() => {
    if (draft === query) return
    const timer = window.setTimeout(() => commit(draft), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, query])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.isComposing || event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return
      if (editable(event.target)) return
      event.preventDefault()
      setOpened(true)
      input.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  function clear() {
    setDraft('')
    if (query !== '') onQueryChange('')
    input.current?.focus()
  }

  function close() {
    setOpened(false)
    setDraft('')
    if (query !== '') onQueryChange('')
  }

  const { prompt } = SEARCH_SCOPE_COPY[scope.kind]
  const open = opened || draft !== ''
  return (
    <form
      className="search"
      role="search"
      data-open={open ? '' : undefined}
      data-filled={draft !== '' ? '' : undefined}
      onSubmit={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="button button-icon search-open"
        aria-label="Search"
        onClick={() => {
          setOpened(true)
          // The field is display:none until the state lands; focus once it shows.
          requestAnimationFrame(() => input.current?.focus())
        }}
      >
        <Icon name="search" />
      </button>
      <button type="button" className="button button-icon search-close" aria-label="Close search" onClick={close}>
        <Icon name="arrow-left" />
      </button>
      <BaseField.Root className="search-field">
        <Icon name="search" />
        <BaseField.Control
          ref={input}
          className="search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          aria-label={prompt}
          placeholder={prompt}
          value={draft}
          onValueChange={setDraft}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && draft !== '') {
              event.preventDefault()
              clear()
            }
          }}
        />
        {draft === '' ? (
          <span className="search-key" aria-hidden="true">
            /
          </span>
        ) : (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
            <Icon name="x" />
          </button>
        )}
      </BaseField.Root>
    </form>
  )
}

function editable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}
