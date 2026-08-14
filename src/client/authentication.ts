import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '../shared/api.js'
import { fetchAuthStatus, onSessionEnded } from './api.js'

/**
 * `locked` asks for the password, `unclaimed` for the deployment's setup
 * secret; the server says which — nothing is inferred here.
 */
export type Access =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'open' }
  | { readonly kind: 'unavailable' }

export interface Gate {
  readonly access: Access
  /** Adopts the status a claim, sign-in, or password change just returned. */
  adopt(status: AuthStatus): void
  recheck(): void
}

export function useAccess(): Gate {
  const [access, setAccess] = useState<Access>({ kind: 'checking' })

  const recheck = useCallback(() => {
    fetchAuthStatus().then(
      (status) => setAccess(accessFor(status)),
      () => setAccess({ kind: 'unavailable' }),
    )
  }, [])

  useEffect(recheck, [recheck])

  useEffect(() => onSessionEnded(() => setAccess({ kind: 'locked' })), [])

  return { access, adopt: (status) => setAccess(accessFor(status)), recheck }
}

function accessFor(status: AuthStatus): Access {
  if (!status.claimed) return { kind: 'unclaimed' }
  return status.authenticated ? { kind: 'open' } : { kind: 'locked' }
}
