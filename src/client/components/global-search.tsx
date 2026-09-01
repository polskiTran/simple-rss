import { Field as BaseField } from '@base-ui/react/field'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { MAX_SEARCH_QUERY_LENGTH, type SearchScope } from '../../shared/api.js'

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

/** The line says what it would answer from, before the first keystroke takes the words' place. */
function promptOf(scope: SearchScope): string {
  switch (scope.kind) {
    case 'everywhere':
      return 'search your reading'
    case 'saved':
      return 'search your saves'
    case 'subscriptions':
      return 'search your feeds'
    case 'feed':
      return 'search this feed'
  }
}

export function GlobalSearch({ query, scope, onQueryChange }: GlobalSearchProps) {
  const input = useRef<HTMLInputElement>(null)

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
      input.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

  const prompt = promptOf(scope)
  return (
    <form className="chrome-search" role="search" onSubmit={(event) => event.preventDefault()}>
      <BaseField.Root>
        <BaseField.Control
          ref={input}
          className="field-input search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          aria-label={prompt}
          placeholder={prompt}
          value={draft}
          onValueChange={setDraft}
        />
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
