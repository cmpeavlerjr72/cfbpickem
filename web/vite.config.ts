import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
