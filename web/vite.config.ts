import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // App-shell service worker. `injectManifest` (not generateSW) because the
    // caching rules are non-negotiable and belong in reviewable source: see
    // src/sw.ts — nothing but the hashed shell is ever cached, and Supabase,
    // ESPN and Kalshi are never intercepted.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // The manifest is hand-authored at public/manifest.webmanifest and
      // linked from index.html, so the plugin must not emit a second one.
      manifest: false,
      // Registration lives in src/pwa.ts so the update/reload behaviour is
      // explicit and testable rather than generated.
      injectRegister: false,
      injectManifest: {
        // Shell only. The icons are fetched by the OS, not the page, and
        // privacy.html/support.html are standalone documents — precaching any
        // of them buys nothing and only risks serving something stale.
        globPatterns: ['index.html', 'assets/*.{js,css}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    proxy: {
      // Kalshi's API has no CORS headers, so the dev server relays it.
      // In production this becomes a tiny proxy (Supabase Edge Function).
      '/kalshi': {
        target: 'https://api.elections.kalshi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kalshi/, '/trade-api/v2'),
      },
    },
  },
})
