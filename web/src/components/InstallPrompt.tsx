/**
 * "Install app" affordance — a slim, dismissible bar under the header.
 *
 * Two platforms, two mechanisms:
 *   • Chromium (Android Chrome/Edge/Samsung, desktop Chrome/Edge) fires
 *     `beforeinstallprompt`. We stash it and hand it back on click, which
 *     opens the real one-tap OS install dialog.
 *   • iOS/iPadOS has NO programmatic install API in any browser — every engine
 *     there is WebKit — so the same button opens a two-step guide instead.
 *
 * Visibility is deliberately conservative: nothing renders when the app is
 * already installed, and nothing renders on a browser that neither fired the
 * event nor is iOS (desktop Firefox, in-app webviews, anything uninstallable),
 * so a context that cannot install never sees a button that cannot work.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  consumeInstallPrompt,
  getInstallPrompt,
  isIOS,
  isStandalone,
  onInstallPromptChange,
} from '../pwa';

const DISMISS_KEY = 'cfb-pickem:install:dismissed';

/** Storage is a convenience, never a dependency: private mode throws on both. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* Blocked storage just means the bar comes back next visit. */
  }
}

export function InstallPrompt() {
  // The event itself is captured at module load in ../pwa (Chrome fires it
  // before React's first effect); this only mirrors the stash into state.
  const [offered, setOffered] = useState<boolean>(() => getInstallPrompt() != null);
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  const ios = isIOS();

  useEffect(() => {
    // Re-read on mount as well as subscribing: the event may have landed
    // between the initial state and this effect.
    setOffered(getInstallPrompt() != null);
    const unsubscribe = onInstallPromptChange(() => setOffered(getInstallPrompt() != null));
    const onInstalled = () => setInstalled(true);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      unsubscribe();
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const onInstallClick = useCallback(async () => {
    // Single-use: taking it clears the stash. Chrome re-fires the event on a
    // later visit if the user declined, and the subscription brings the bar
    // back when it does.
    const prompt = consumeInstallPrompt();
    if (prompt) {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      return;
    }
    setShowIOSGuide(true);
  }, []);

  const onDismiss = useCallback(() => {
    setDismissed(true);
    setShowIOSGuide(false);
    writeDismissed();
  }, []);

  if (installed || dismissed) return null;
  if (!offered && !ios) return null;

  return (
    <>
      <div className="install-bar" role="region" aria-label="Install this app">
        <span className="install-bar-text">Add Saturday Sweats to your home screen.</span>
        <button type="button" className="install-bar-cta" onClick={onInstallClick}>
          Install app
        </button>
        <button
          type="button"
          className="install-bar-x"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
        >
          &times;
        </button>
      </div>

      {showIOSGuide && (
        <div
          className="install-sheet-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Add to Home Screen"
          onClick={() => setShowIOSGuide(false)}
        >
          <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="install-sheet-head">
              <strong>Add to Home Screen</strong>
              <button
                type="button"
                className="install-bar-x"
                onClick={() => setShowIOSGuide(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <ol className="install-sheet-steps">
              <li>
                <span>
                  Tap the <b>Share</b> button in the browser toolbar
                </span>
                <ShareGlyph />
              </li>
              <li>
                <span>
                  Choose <b>Add to Home Screen</b>
                </span>
                <PlusSquareGlyph />
              </li>
            </ol>
            <p className="install-sheet-note">
              Works in Safari, and in Chrome or Edge on iOS 16.4 and later.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/** iOS Share: a box with an arrow leaving through the top. */
function ShareGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 3v11M12 3l-3.5 3.5M12 3l3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 10.5H5.25A1.25 1.25 0 0 0 4 11.75v7A1.25 1.25 0 0 0 5.25 20h13.5A1.25 1.25 0 0 0 20 18.75v-7a1.25 1.25 0 0 0-1.25-1.25H17.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The "Add to Home Screen" row icon: a plus inside a rounded square. */
function PlusSquareGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
