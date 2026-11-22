import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '../shared/api.js'
import { failureKind, fetchAuthStatus, onSessionEnded } from './api.js'

type Access =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'open' }
  | { readonly kind: 'unreachable' | 'unavailable'; readonly attempts: number }

export interface Gate {
  readonly access: Access
  adopt(status: AuthStatus): void
  recheck(): Promise<void>
}

const MOST_PATIENT_MS = 60_000

export function useAccess(): Gate {
  const [access, setAccess] = useState<Access>({ kind: 'checking' })

  const recheck = useCallback(
    () =>
      fetchAuthStatus().then(
        (status) => setAccess(accessFor(status)),
        (error) =>
          setAccess((previous) => ({
            kind: failureKind(error),
            attempts: 'attempts' in previous ? previous.attempts + 1 : 1,
          })),
      ),
    [],
  )

  useEffect(() => {
    void recheck()
  }, [recheck])

  useEffect(() => onSessionEnded(() => setAccess({ kind: 'locked' })), [])

  useEffect(() => {
    if (!('attempts' in access)) return
    const again = () => void recheck()
    const visible = () => {
      if (document.visibilityState === 'visible') again()
    }
    const timer = setTimeout(again, Math.min(MOST_PATIENT_MS, 2_000 * 2 ** (access.attempts - 1)))
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [access, recheck])

  return { access, adopt: (status) => setAccess(accessFor(status)), recheck }
}

function accessFor(status: AuthStatus): Access {
  if (!status.claimed) return { kind: 'unclaimed' }
  return status.authenticated ? { kind: 'open' } : { kind: 'locked' }
}
