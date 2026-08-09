import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import { applyAppearance, storedAppearance } from './appearance.js'
import './styles.css'

// Before the first paint, so a device that pinned dark never flashes light.
applyAppearance(storedAppearance())

/**
 * The client is a plain responsive web application. There is deliberately no
 * service worker registration, install manifest, client-side database, or
 * analytics call anywhere in this entrypoint.
 */
const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
