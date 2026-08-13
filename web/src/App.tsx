import { useCallback, useEffect, useMemo, useState } from 'react';
import gamesJson from './data/games.json';
import type { Game, SeasonData, WeekData } from './types';
import { isGameLocked } from './results';
import { useWeekResults } from './live';
import type { CoverOdds, PickSide, PoolEntry, PoolProfile, PoolSettings, WeekSlate } from './pool/types';
import { DEFAULT_SETTINGS } from './pool/types';
import type { PoolStore } from './pool/store';
import { fetchCoverOddsForSlate } from './pool/kalshi';
import { PickSheet } from './components/PickSheet';
import { SlateBuilder } from './components/SlateBuilder';
import { ScoreboardTab } from './components/ScoreboardTab';
import { StandingsTab } from './components/StandingsTab';
import './App.css';

const season = gamesJson as SeasonData;

// Default to the first week that hasn't fully finished yet.
function defaultWeekIndex(weeks: WeekData[]): number {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const idx = weeks.findIndex((w) =>
    w.games.some((g) => new Date(g.date).getTime() > cutoff),
  );
  return idx === -1 ? 0 : idx;
}

type Tab = 'picks' | 'board' | 'standings' | 'slate';

interface AppProps {
  store: PoolStore;
  profile: PoolProfile;
  inviteCode?: string;
  onSignOut?: () => void;
}

export default function App({ store, profile, inviteCode, onSignOut }: AppProps) {
  const [settings, setSettings] = useState<PoolSettings>(DEFAULT_SETTINGS);
  const [tab, setTab] = useState<Tab>('picks');
  const [weekIndex, setWeekIndex] = useState(() => defaultWeekIndex(season.weeks));
  const week = season.weeks[weekIndex];
  const [slate, setSlate] = useState<WeekSlate | null>(null);
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [coverOdds, setCoverOdds] = useState<Record<string, CoverOdds>>({});
  const results = useWeekResults(season.season, week);

  useEffect(() => {
    store.getSettings().then(setSettings);
  }, [store]);

  const refresh = useCallback(async () => {
    const [s, e] = await Promise.all([
      store.getSlate(season.season, week.seasonType, week.week),
      store.getEntries(season.season, week.seasonType, week.week),
    ]);
    setSlate(s);
    setEntries(e);
  }, [store, week]);

  // Load on week change, then keep fresh (other players' picks, slate
  // publishes) with a 60s poll while the tab is visible.
  useEffect(() => {
    setSlate(null);
    setEntries([]);
    refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  // Kalshi cover odds: refresh every minute while a published slate is open.
  useEffect(() => {
    setCoverOdds({});
    if (!slate?.published || slate.games.length === 0) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      const odds = await fetchCoverOddsForSlate(slate, gamesById);
      if (!cancelled) setCoverOdds(odds);
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slate, gamesById]);

  const myEntry = useMemo<PoolEntry>(() => {
    const existing = entries.find((e) => e.playerId === profile.playerId);
    return (
      existing ?? {
        playerId: profile.playerId,
        playerName: profile.playerName,
        picks: {},
        tiebreaker: null,
        updatedAt: '',
      }
    );
  }, [entries, profile]);

  const saveMyEntry = (mutate: (entry: PoolEntry) => PoolEntry) => {
    const next = { ...mutate(myEntry), updatedAt: new Date().toISOString() };
    setEntries((prev) => {
      const others = prev.filter((e) => e.playerId !== profile.playerId);
      return [...others, next];
    });
    store.saveEntry(season.season, week.seasonType, week.week, next).catch((err) => {
      alert(
        err instanceof Error && err.message.includes('locked')
          ? 'Too late — that game already kicked off.'
          : `Couldn’t save your pick: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refresh();
    });
  };

  const handlePick = (gameId: string, side: PickSide) => {
    const game = gamesById.get(gameId);
    if (!game || !slate?.published || isGameLocked(game, results[gameId])) return;
    saveMyEntry((entry) => {
      const picks = { ...entry.picks };
      if (picks[gameId] === side) delete picks[gameId];
      else picks[gameId] = side;
      return { ...entry, picks };
    });
  };

  const handleTiebreaker = (home: number | null, away: number | null) => {
    saveMyEntry((entry) => ({
      ...entry,
      tiebreaker: home == null && away == null ? null : { home: home ?? 0, away: away ?? 0 },
    }));
  };

  const handleSlateSave = (s: WeekSlate) => {
    setSlate(s);
    store.saveSlate(s).catch((err) => {
      alert(`Couldn’t save the slate: ${err instanceof Error ? err.message : 'unknown error'}`);
      refresh();
    });
  };

  const slateGameIds = slate?.published ? slate.games.map((g) => g.gameId) : [];
  const pickedCount = slateGameIds.filter((id) => myEntry.picks[id]).length;
  const allPicked = slateGameIds.length > 0 && pickedCount === slateGameIds.length;
  const tiebreakerSet = myEntry.tiebreaker != null;
  const showPickBar = tab === 'picks' && slateGameIds.length > 0;

  return (
    <div className={`app${showPickBar ? '' : ' no-pick-bar'}`}>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <span className="app-logo">🏈</span>
            <span className="app-title">{settings.name}</span>
            <span className="app-season">{season.season} Season</span>
            <span className="app-user">
              {profile.playerName}
              {onSignOut && (
                <button type="button" className="signout-btn" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </span>
          </div>
          <nav className="app-tabs">
            <button
              type="button"
              className={tab === 'picks' ? 'active' : ''}
              onClick={() => setTab('picks')}
            >
              My Picks
            </button>
            <button
              type="button"
              className={tab === 'board' ? 'active' : ''}
              onClick={() => setTab('board')}
            >
              Scoreboard
            </button>
            <button
              type="button"
              className={tab === 'standings' ? 'active' : ''}
              onClick={() => setTab('standings')}
            >
              Standings
            </button>
            {profile.isCommissioner && (
              <button
                type="button"
                className={tab === 'slate' ? 'active' : ''}
                onClick={() => setTab('slate')}
              >
                Slate
              </button>
            )}
          </nav>
        </div>
      </header>

      <div className="week-picker">
        <div className="week-picker-inner">
          {season.weeks.map((w, i) => (
            <button
              key={`${w.seasonType}-${w.week}`}
              type="button"
              className={`week-pill${i === weekIndex ? ' active' : ''}`}
              onClick={() => setWeekIndex(i)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <main className="game-list">
        {tab === 'picks' && (
          <PickSheet
            week={week}
            slate={slate}
            entry={myEntry}
            results={results}
            coverOdds={coverOdds}
            onPick={handlePick}
            onTiebreaker={handleTiebreaker}
          />
        )}
        {tab === 'board' && (
          <ScoreboardTab
            week={week}
            slate={slate}
            entries={entries}
            results={results}
            coverOdds={coverOdds}
            currentPlayerId={profile.playerId}
          />
        )}
        {tab === 'standings' && (
          <StandingsTab
            season={season}
            settings={settings}
            store={store}
            weekIndex={weekIndex}
            currentPlayerId={profile.playerId}
          />
        )}
        {tab === 'slate' && profile.isCommissioner && (
          <SlateBuilder
            week={week}
            slate={slate}
            settings={settings}
            season={season.season}
            inviteCode={inviteCode}
            onSave={handleSlateSave}
          />
        )}
      </main>

      {showPickBar && (
        <footer className="pick-bar">
          <div className="pick-bar-inner">
            <div className="pick-progress">
              <span className="pick-count">
                {pickedCount} of {slateGameIds.length} picks
                {tiebreakerSet ? ' · TB in' : ' · TB missing'}
              </span>
              <div className="pick-meter">
                <div
                  className="pick-meter-fill"
                  style={{
                    width: `${(pickedCount / Math.max(slateGameIds.length, 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              className="submit-btn"
              disabled={pickedCount === 0}
              onClick={() =>
                alert(
                  allPicked && tiebreakerSet
                    ? `Sheet complete — ${pickedCount} picks + tiebreaker in for ${week.label}! 🔒`
                    : `${pickedCount}/${slateGameIds.length} picks saved${tiebreakerSet ? '' : ' — don’t forget the tiebreaker'}. You can change them until kickoff.`,
                )
              }
            >
              {allPicked && tiebreakerSet ? 'Sheet Complete' : 'Save Picks'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
