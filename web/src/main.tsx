// ./pwa is imported FIRST on purpose: it registers the beforeinstallprompt
// listener at module load, and Chrome can fire that event before React mounts.
import { registerServiceWorker } from './pwa'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// App-shell service worker, production builds only (see src/sw.ts).
registerServiceWorker()
