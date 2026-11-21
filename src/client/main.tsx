import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import { applyAppearance, storedAppearance } from './appearance.js'
import './styles.css'

applyAppearance(storedAppearance())

if (import.meta.env.DEV) (await import('./dev/worst-case.js')).install()

const container = document.getElementById('root')
if (!container) {
  throw new Error('Missing #root element')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
