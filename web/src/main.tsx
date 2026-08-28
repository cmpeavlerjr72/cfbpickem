import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.tsx'
import { registerServiceWorker } from './pwa'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// App-shell service worker, production builds only (see src/sw.ts).
registerServiceWorker()
