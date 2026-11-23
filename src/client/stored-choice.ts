import { useSyncExternalStore } from 'react'

export interface StoredChoice<Value extends string> {
  readonly options: readonly [Value, ...Value[]]
  read(): Value
  choose(value: Value): void
}

const listeners = new Set<() => void>()

export function storedChoice<const Value extends string>(
  key: string,
  options: readonly [Value, ...Value[]],
): StoredChoice<Value> {
  const [fallback] = options
  return {
    options,
    read() {
      try {
        const stored = localStorage.getItem(key)
        return options.find((option) => option === stored) ?? fallback
      } catch {
        return fallback
      }
    },
    choose(value) {
      try {
        if (value === fallback) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch {}
      for (const listener of listeners) listener()
    },
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

export function useStoredChoice<Value extends string>(choice: StoredChoice<Value>): Value {
  return useSyncExternalStore(subscribe, choice.read)
}
