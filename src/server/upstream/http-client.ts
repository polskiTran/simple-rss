/**
 * How the hardened retrieval boundary reaches the network.
 *
 * Keeping it a dependency means tests serve fixtures instead of reaching the
 * network, and it keeps transport concerns — connecting, decoding, tearing a
 * socket down — separate from the policy in `retrieval.ts`. The composition root
 * holds one only to hand it to the boundary; nothing should ever retrieve
 * through one directly, which would skip every check the boundary applies.
 *
 * An implementation must not follow redirects; each hop is validated above it.
 *
 * See `network-client.ts` for the real one.
 */
export type HttpClient = (request: Request) => Promise<Response>
