/**
 * Service-worker registration + the install-prompt platform probes.
 *
 * Registration is hand-written rather than generated (vite-plugin-pwa runs
 * with `injectRegister: false`) so the update path is reviewable. A stale,
 * pinned service worker is THE classic PWA failure, and on a pick'em app it
 * would be a silent data bug — someone's phone still serving August's bundle
 * while the commissioner ships a fix mid-season.
 */

/** Not in lib.dom yet — Chromium-only, and it is the whole install API. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/**
 * The install event is captured HERE, at module load, not in a component
 * effect — Chrome fires `beforeinstallprompt` as soon as its criteria are met,
 * which on a repeat visit beats React's first effect. Registering late cost us
 * both halves of the feature on the user's Android test: the event was never
 * stashed (so the in-app button had nothing to open) and it was never
 * preventDefault'd (so Chrome showed its own install popup instead).
 *
 * main.tsx imports this module first, so the listener is live before the app
 * renders. The listener is never removed: Chrome re-fires the event on a later
 * visit if the user declined, and the button has to come back when it does.
 */
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

function notifyPromptChange(): void {
  for (const fn of promptListeners) fn();
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppresses Chrome's mini-infobar / bottom sheet so our button is the
    // single entry point. Without it the event is not reusable later either.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyPromptChange();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyPromptChange();
  });
}

/** The stashed event, or null when the browser has not offered an install. */
export function getInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

/** Take the event for a `prompt()` call — it is single-use once shown. */
export function consumeInstallPrompt(): BeforeInstallPromptEvent | null {
  const p = deferredPrompt;
  deferredPrompt = null;
  notifyPromptChange();
  return p;
}

/** Subscribe to stash changes (a fire, a re-fire, or an install). */
export function onInstallPromptChange(fn: () => void): () => void {
  promptListeners.add(fn);
  return () => {
    promptListeners.delete(fn);
  };
}

/** True when the page is running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true
  );
}

/**
 * iOS/iPadOS has no programmatic install API in ANY browser — every engine on
 * the platform is WebKit, so Chrome and Edge for iOS need the same Share-sheet
 * instructions Safari does (and since iOS 16.4 they can actually perform it).
 * iPadOS reports itself as a Mac, hence the touch-point probe.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/** Android, where an install is possible but Chrome may never offer it to us. */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/.test(navigator.userAgent || '');
}

/**
 * Best-effort "is our own WebAPK already on this phone?".
 *
 * Chrome suppresses `beforeinstallprompt` for a while after someone installs
 * or dismisses, so its absence does NOT mean "cannot install" — which is why
 * the Android fallback button exists. This is the one signal that separates
 * the two cases, and it only works when the manifest lists itself under
 * `related_applications`.
 *
 * Unavailable everywhere but Chrome/Android, so a false answer is the safe
 * default: worst case an installed member sees instructions for something
 * they have already done, which beats an uninstalled member seeing nothing.
 */
export async function hasInstalledRelatedApp(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
    };
    if (typeof nav.getInstalledRelatedApps !== 'function') return false;
    const apps = await nav.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.length > 0;
  } catch {
    return false;
  }
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // The FIRST worker to claim this page is claiming the very load that
  // installed it — the assets on screen are already that build, so reloading
  // would just be a flash. Only a REPLACEMENT controller means new code, and
  // that is the case worth a reload.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Re-check on every return to the tab: a phone that lives on the home
        // screen from Tuesday to Saturday otherwise never asks whether a
        // deploy happened.
        const check = () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        };
        document.addEventListener('visibilitychange', check);
        window.setInterval(check, 60 * 60 * 1000);
      })
      .catch(() => {
        /* No worker is a fully working site; never break boot over it. */
      });
  });
}
