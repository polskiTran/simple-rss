/**
 * How the hardened retrieval boundary reaches the network.
 *
 * Keeping it a dependency means tests serve fixtures instead of reaching the
 * network, and it keeps transport concerns — connecting, decoding, tearing a
 * socket down — separate from the policy in `retrieval.ts`. Nothing outside
 * `upstream/` should hold one of these: retrieving through it directly would
 * skip every check the boundary exists to apply.
 *
 * An implementation must not follow redirects; each hop is validated above it.
 *
 * See `network-client.ts` for the real one.
 */
export type HttpClient = (request: Request) => Promise<Response>
