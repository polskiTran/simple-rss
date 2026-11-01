// The app's own Vite config with the proxy removed and its own port and cache.
// With no proxy, a request the dev mock does not answer cannot reach the
// developer's server on 8080, and this instance never shares `node_modules/.vite`.
import base from '../../../../vite.config.ts'

export default {
  ...base,
  cacheDir: process.env.VERIFY_VITE_CACHE,
  server: { host: '127.0.0.1', port: 5199, strictPort: true, proxy: {} },
}
