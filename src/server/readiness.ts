/**
 * Whether the service may take traffic.
 *
 * Liveness answers "is this process responsive"; readiness answers "has
 * startup finished and is the volume still usable". They are separate so a
 * migration failure or a full volume stops traffic without triggering a
 * restart loop that would never fix either.
 */
export type ReadinessState =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string }

export class Readiness {
  #state: ReadinessState = { kind: 'starting' }

  get state(): ReadinessState {
    return this.#state
  }

  markReady(): void {
    this.#state = { kind: 'ready' }
  }

  markFailed(reason: string): void {
    this.#state = { kind: 'failed', reason }
  }
}
