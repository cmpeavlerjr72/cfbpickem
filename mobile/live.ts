// Adaptive live polling — mirrors web/src/live.ts (see CLAUDE.md parity
// rule): 20s while any game is in progress, 2min otherwise, stop when the
// week is done. Web pauses on document.hidden; here the equivalent is
// AppState (backgrounded app polls nothing, foregrounding re-ticks).

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { WeekData } from './types';
import type { WeekResults } from './results';
import { getWeekResults } from './results';

const LIVE_MS = 20_000;
const IDLE_MS = 120_000;
const BACKGROUND_MS = 30_000;

export function useWeekResults(season: number, week: WeekData): WeekResults {
  const [results, setResults] = useState<WeekResults>({});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setResults({});

    const schedule = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (cancelled) return;
      if (AppState.currentState !== 'active') {
        schedule(BACKGROUND_MS);
        return;
      }
      const r = await getWeekResults(season, week);
      if (cancelled) return;
      setResults(r);
      const allFinal =
        week.games.length > 0 && week.games.every((g) => r[g.id]?.state === 'post');
      if (allFinal) return;
      const anyLive = Object.values(r).some((g) => g.state === 'in');
      schedule(anyLive ? LIVE_MS : IDLE_MS);
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      sub.remove();
    };
  }, [season, week]);

  return results;
}
