/// <reference lib="webworker" />
/**
 * Saturday Sweats service worker — app shell ONLY.
 *
 * The one hard rule: this worker never caches data. Picks, entries, slates,
 * live ESPN scores and Kalshi quotes must hit the network exactly as they
 * would with no worker installed. A stale scoreboard on Saturday afternoon —
 * or worse, a stale pick sheet that hides someone's saved picks — is far
 * worse than no offline support at all.
 *
 * That is enforced structurally, not by a denylist. The ONLY routes registered
 * are:
 *   1. workbox's precache route, which matches exact, hashed, same-origin URLs
 *      from the build manifest and nothing else, and
 *   2. a navigation route (network-first) for the SPA document.
 *
 * Everything else — the Supabase REST/auth/realtime calls, the Kalshi Edge
 * Function, site.api.espn.com, sports.core.api.espn.com — is cross-origin and
 * matches no route, so it falls through the router without `respondWith`, i.e.
 * the browser performs its normal network fetch. Do NOT add
 * `setDefaultHandler`, and do NOT add runtime caching for any origin.
 *
 * Update path: skipWaiting + clientsClaim, plus network-first navigations, so
 * a Render deploy is live on the next launch instead of pinning a member to
 * the build they installed in August.
 */
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, getCacheKeyForURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

self.skipWaiting();
clientsClaim();

cleanupOutdatedCaches();

// index.html + the hashed /assets/* bundle. Immutable filenames, so cache-first
// is safe: a new deploy means new names and a new manifest, never a stale hit.
precacheAndRoute(self.__WB_MANIFEST);

/**
 * Navigations go to the network first so a deploy is picked up immediately,
 * with the precached index.html as the offline floor. The timeout keeps a
 * dead-but-not-refused connection (stadium wifi) from hanging the launch.
 */
const shellFallback = async (): Promise<Response> => {
  const key = getCacheKeyForURL('/index.html');
  const cached = key ? await caches.match(key) : undefined;
  return cached ?? Response.error();
};

registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'satsweats-shell',
      networkTimeoutSeconds: 4,
      plugins: [{ handlerDidError: shellFallback }],
    }),
    {
      // Real files served alongside the SPA (the App Store privacy/support
      // pages) and the dev Kalshi proxy must reach the server, never the shell.
      denylist: [/^\/privacy\.html$/, /^\/support\.html$/, /^\/kalshi\//],
    },
  ),
);
