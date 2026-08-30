// The one place that turns a season's stored slates + entries into scored
// weeks. Shared by the Standings tab and the weekly-winner celebration so the
// two can never crown different people — the celebration used to reimplement
// these guards inline, which is how it ended up disagreeing about which week
// was even in play.
//
// It also carries the cumulative season-points map forward week by week, which
// is what makes tiebreak level 5 ("best season record so far") possible: that
// number only exists if you've scored the earlier weeks first.

import type { SeasonData } from '../types';
import { getWeekResults } from '../results';
import type { PoolSettings } from './types';
import type { PoolStore } from './store';
import type { ScoredWeek } from './scoring';
import { countsTowardSeason, isWeekComplete, scoreWeek } from './scoring';

export interface LoadScoredWeeksOptions {
  /**
   * Skip weeks that haven't kicked off at all yet — they can't be complete, so
   * the celebration's mount-time sweep can stop paying for their fetches.
   * Standings leaves this off: it shows live and partial weeks too.
   */
  onlyStartedWeeks?: boolean;
}

export async function loadScoredWeeks(
  season: SeasonData,
  settings: PoolSettings,
  store: PoolStore,
  options: LoadScoredWeeksOptions = {},
): Promise<ScoredWeek[]> {
  const out: ScoredWeek[] = [];
  // Cumulative points per playerId from the weeks already scored above — the
  // "prior weeks" input to tiebreak level 5. Week 0 never contributes, matching
  // seasonStandings (season record starts Week 1).
  const seasonPoints: Record<string, number> = {};
  const now = Date.now();
  for (const weekData of season.weeks) {
    if (options.onlyStartedWeeks) {
      const started = weekData.games.some((g) => {
        const t = new Date(g.date).getTime();
        return Number.isFinite(t) && t <= now;
      });
      if (!started) continue;
    }
    const slate = await store.getSlate(season.season, weekData.seasonType, weekData.week);
    if (!slate || !slate.published || slate.games.length === 0) continue;
    const entries = await store.getEntries(season.season, weekData.seasonType, weekData.week);
    if (entries.length === 0) continue;
    const results = await getWeekResults(season.season, weekData);
    // Snapshot the map: this week's own points must not feed its own tiebreak.
    const scores = scoreWeek(slate, entries, results, settings, { ...seasonPoints });
    const scoredWeek: ScoredWeek = {
      slate,
      label: weekData.label,
      scores,
      complete: isWeekComplete(slate, results),
    };
    out.push(scoredWeek);
    if (countsTowardSeason(scoredWeek)) {
      for (const s of scores) {
        seasonPoints[s.entry.playerId] = (seasonPoints[s.entry.playerId] ?? 0) + s.points;
      }
    }
  }
  return out;
}
