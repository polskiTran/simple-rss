import { useCallback, useEffect, useState } from 'react'
import type { AuthStatus } from '../shared/api.js'
import { fetchAuthStatus, onSessionEnded } from './api.js'

/**
 * Which of the three screens the installation is on, from the client's side.
 *
 * `locked` and `unclaimed` are deliberately distinct: one asks for a password
 * and the other asks for the deployment's setup secret, and offering the wrong
 * one is the difference between a reader that makes sense and one that does
 * not. The server tells the client which it is; nothing is inferred here.
 */
export type Access =
  | { readonly kind: 'checking' }
  | { readonly kind: 'unclaimed' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'open' }
  | { readonly kind: 'unavailable' }

export interface Gate {
  readonly access: Access
  /** Takes the status a claim, sign-in, or password change just returned. */
  adopt(status: AuthStatus): void
  /** Asks the server again, after something the client could not observe. */
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

  // A session can end while the reader is open — it idles out, or the password
  // changes on the other device. The shell finds out from the first request
  // that is refused rather than by polling.
  useEffect(() => onSessionEnded(() => setAccess({ kind: 'locked' })), [])

  return { access, adopt: (status) => setAccess(accessFor(status)), recheck }
}

function accessFor(status: AuthStatus): Access {
  if (!status.claimed) return { kind: 'unclaimed' }
  return status.authenticated ? { kind: 'open' } : { kind: 'locked' }
}
