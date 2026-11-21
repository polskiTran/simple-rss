import base from '../../../../vite.config.ts'

export default {
  ...base,
  cacheDir: process.env.VERIFY_VITE_CACHE,
  server: { host: '127.0.0.1', port: 5199, strictPort: true, proxy: {} },
}
