/**
 * The single door to the outside world: Feed retrieval, Reader extraction, and
 * the image proxy all go through it. Keeping it a dependency means tests serve
 * fixtures instead of reaching the network, and the hardened fetcher can later
 * wrap it in one place rather than at every call site.
 */
export type HttpClient = (request: Request) => Promise<Response>

export const networkHttpClient: HttpClient = (request) => fetch(request)
