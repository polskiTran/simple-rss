import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import './styles.css'

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
