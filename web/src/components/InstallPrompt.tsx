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
  hasInstalledRelatedApp,
  isAndroid,
  isIOS,
  isStandalone,
  onInstallPromptChange,
} from '../pwa';

const SNOOZE_KEY = 'cfb-pickem:install:snoozeUntil';
/** The old boolean meant "never show again" — deliberately retired below. */
const LEGACY_DISMISS_KEY = 'cfb-pickem:install:dismissed';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long to wait for Chrome to offer an install before falling back to
 * manual instructions. Chrome suppresses `beforeinstallprompt` for a cooldown
 * after a dismissal (and forever once installed), so "no event" is not
 * "cannot install" — without this the button silently never appears, which is
 * exactly what happened on the first Android test.
 */
const OFFER_GRACE_MS = 3000;

/**
 * Storage is a convenience, never a dependency: private mode throws on both.
 *
 * This is a SNOOZE, not a dismissal. These are league members who want the app
 * on their phone; hiding the banner forever because they tapped an X once is
 * the wrong default. Only the X on the banner writes it — reading the
 * instructions never does, since opening the guide is the strongest
 * install-intent signal we have.
 */
function readSnoozed(): boolean {
  try {
    // The old flag meant "never show again". Retire it on sight so anyone it
    // silenced gets the banner back.
    window.localStorage.removeItem(LEGACY_DISMISS_KEY);
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (!Number.isFinite(until)) {
      window.localStorage.removeItem(SNOOZE_KEY);
      return false;
    }
    if (Date.now() >= until) {
      window.localStorage.removeItem(SNOOZE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function writeSnooze(): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    /* Blocked storage just means the bar comes back next visit. */
  }
}

export function InstallPrompt() {
  // The event itself is captured at module load in ../pwa (Chrome fires it
  // before React's first effect); this only mirrors the stash into state.
  const [offered, setOffered] = useState<boolean>(() => getInstallPrompt() != null);
  const [snoozed, setSnoozed] = useState<boolean>(() => readSnoozed());
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [guide, setGuide] = useState<'ios' | 'android' | null>(null);
  /** Chrome had its chance to offer an install and didn't. */
  const [graceElapsed, setGraceElapsed] = useState(false);

  const ios = isIOS();
  const android = isAndroid();

  // Android only: start the grace clock, and ask Chrome whether our own WebAPK
  // is already on the phone (the one signal that tells "already installed"
  // apart from "in a dismissal cooldown").
  useEffect(() => {
    if (!android) return;
    const timer = window.setTimeout(() => setGraceElapsed(true), OFFER_GRACE_MS);
    let cancelled = false;
    hasInstalledRelatedApp().then((yes) => {
      if (!cancelled && yes) setInstalled(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [android]);

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
      if (outcome === 'accepted') {
        setInstalled(true);
      } else {
        // Declining the OS dialog is a real "not now" — but capped at the same
        // 7 days, not forever.
        setSnoozed(true);
        writeSnooze();
      }
      return;
    }
    // No event to hand back: show the manual path for this platform.
    setGuide(isIOS() ? 'ios' : 'android');
  }, []);

  /**
   * ONLY the X on the banner snoozes. Closing the instructions does not —
   * someone who opened the guide and walked away to think about it is the most
   * likely installer we have, and the banner has to be waiting when they come
   * back (this session and later ones).
   */
  const onSnooze = useCallback(() => {
    setSnoozed(true);
    setGuide(null);
    writeSnooze();
  }, []);

  /** Close the overlay only — never records anything. */
  const closeGuide = useCallback(() => setGuide(null), []);

  if (installed || snoozed) return null;
  // Android with no offer after the grace period still gets the button — it
  // just opens instructions instead of the OS dialog.
  const androidFallback = android && graceElapsed && !offered;
  if (!offered && !ios && !androidFallback) return null;

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
          onClick={onSnooze}
          aria-label="Not now — hide this for a week"
          title="Not now"
        >
          &times;
        </button>
      </div>

      {guide && (
        <div
          className="install-sheet-scrim"
          role="dialog"
          aria-modal="true"
          aria-label="Add to Home Screen"
          onClick={closeGuide}
        >
          <div className="install-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="install-sheet-head">
              <strong>Add to Home Screen</strong>
              <button
                type="button"
                className="install-bar-x"
                onClick={closeGuide}
                aria-label="Close these instructions"
              >
                &times;
              </button>
            </div>
            {guide === 'ios' ? (
              <>
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
                  <br />
                  Already added it? You’re all set — open it from your home screen.
                </p>
              </>
            ) : (
              <>
                <ol className="install-sheet-steps">
                  <li>
                    <span>
                      Tap the <b>⋮ menu</b> in the Chrome toolbar
                    </span>
                    <DotsGlyph />
                  </li>
                  <li>
                    <span>
                      Choose <b>Add to Home screen</b> (or <b>Install app</b>)
                    </span>
                    <PhonePlusGlyph />
                  </li>
                </ol>
                <p className="install-sheet-note">
                  Chrome only offers its one-tap install once in a while — this is the manual
                  route.
                  <br />
                  Already added it? You’re all set — open it from your home screen.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Chrome's overflow menu: three vertical dots. */
function DotsGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        <circle cx="12" cy="5" r="1.9" />
        <circle cx="12" cy="12" r="1.9" />
        <circle cx="12" cy="19" r="1.9" />
      </g>
    </svg>
  );
}

/** "Add to Home screen": a phone with a plus on it. */
function PhonePlusGlyph() {
  return (
    <svg className="install-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect
        x="6"
        y="2.5"
        width="12"
        height="19"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
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
