/**
 * The running build, reported by `GET /api/meta`.
 *
 * Kept as a literal rather than read from `package.json`, which is not part of
 * the compiled output. `tests/server/version.test.ts` fails if the two drift.
 */
export const VERSION = '0.1.0-rc.5'
