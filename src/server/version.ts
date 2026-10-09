import { readFileSync } from 'node:fs'
import { z } from 'zod'

/**
 * The release this server reports — `/api/meta`, the User Export, the
 * outbound User-Agent. Read once from `package.json`, which sits two levels up
 * from both `src/server/` and the built `dist/server/`; the image ships it.
 */
export const VERSION = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))).version
