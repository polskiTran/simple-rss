import { Field as BaseField } from '@base-ui/react/field'
import { useEffect, useRef } from 'react'
import { MAX_SEARCH_QUERY_LENGTH } from '../../shared/api.js'

export interface GlobalSearchProps {
  query: string
  onQueryChange(query: string): void
}

export function GlobalSearch({ query, onQueryChange }: GlobalSearchProps) {
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || editable(event.target)) return
      event.preventDefault()
      input.current?.focus()
    }
    document.addEventListener('keydown', focusSearch)
    return () => document.removeEventListener('keydown', focusSearch)
  }, [])

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
          aria-label="search your reading"
          placeholder="search your reading"
          value={query}
          onValueChange={onQueryChange}
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
