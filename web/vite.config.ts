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
      // KILL SWITCH (2026-08-28, ported from monte_site the same night): ships
      // a sw.js whose only job is to UNREGISTER any existing worker and reload
      // its clients. The sibling app's identical worker architecture stranded
      // the owner's phone fully blank TWICE in one evening of rapid deploys —
      // registration alive with broken state, incognito always fine. League
      // members can't be asked to dig through site settings, so this app gets
      // the cure BEFORE its first stranding. Installability and the manifest
      // stay; the app runs as an online site — the worker only ever cached the
      // shell (live picks/scores were always network, by the rule above).
      // Re-introduce a caching worker only with a reviewed design that answers
      // the stranding mode.
      selfDestroying: true,
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
