// EAS Update (OTA) helper. Default expo-updates behavior (checkAutomatically:
// ON_LOAD, fallbackToCacheTimeout: 0) downloads a new update in the
// background on launch but only *applies* it on the NEXT cold start — so a
// player can sit on a stale bundle indefinitely if they don't fully kill the
// app. This hook checks on mount and applies immediately if we're still
// within the first few seconds of a cold launch (nothing to lose — the user
// hasn't touched anything yet); otherwise it surfaces `updateReady` so the
// UI can offer a manual restart instead of yanking someone off a
// half-entered pick sheet. It also re-checks whenever the app returns to the
// foreground (throttled), since a player can leave the app open for days.
//
// No-op in Expo Go / a dev client, where these native APIs throw.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';

const COLD_LAUNCH_WINDOW_MS = 5_000;
const FOREGROUND_CHECK_THROTTLE_MS = 60_000;

export interface UseOtaUpdatesResult {
  updateReady: boolean;
  restart: () => void;
}

export function useOtaUpdates(): UseOtaUpdatesResult {
  const disabled = __DEV__ || !Updates.isEnabled;

  const [updateReady, setUpdateReady] = useState(false);
  const mountedAt = useRef(Date.now());
  const lastCheckAt = useRef(0);
  const checking = useRef(false);

  const checkForUpdate = useCallback(async (allowAutoReload: boolean) => {
    if (disabled || checking.current) return;
    checking.current = true;
    lastCheckAt.current = Date.now();
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return;
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) return;
      const withinColdLaunchWindow = Date.now() - mountedAt.current <= COLD_LAUNCH_WINDOW_MS;
      if (allowAutoReload && withinColdLaunchWindow) {
        await Updates.reloadAsync();
      } else {
        setUpdateReady(true);
      }
    } catch {
      // Never crash the app over a failed update check/download.
    } finally {
      checking.current = false;
    }
  }, [disabled]);

  // Cold-launch check: auto-reload if it lands within the first few seconds.
  useEffect(() => {
    if (disabled) return;
    checkForUpdate(true);
  }, [disabled, checkForUpdate]);

  // Foreground check: throttled, never auto-reloads (user may be mid-pick).
  useEffect(() => {
    if (disabled) return;
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active') return;
      if (Date.now() - lastCheckAt.current < FOREGROUND_CHECK_THROTTLE_MS) return;
      checkForUpdate(false);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [disabled, checkForUpdate]);

  const restart = useCallback(() => {
    if (disabled) return;
    try {
      Updates.reloadAsync().catch(() => {
        // Never crash the app over a failed restart attempt.
      });
    } catch {
      // Never crash the app over a failed restart attempt.
    }
  }, [disabled]);

  return { updateReady: disabled ? false : updateReady, restart };
}
