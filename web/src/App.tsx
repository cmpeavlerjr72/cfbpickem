import { useCallback, useEffect, useMemo, useState } from 'react';
import gamesJson from './data/games.json';
import type { Game, SeasonData, WeekData } from './types';
import { fetchWeekScoreboard, isGameLocked } from './results';
import { useWeekResults } from './live';
import { spreadLockTime } from './pool/spreads';
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

  // Ticks every 30s so the slate lock flips on time without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    store.getSettings().then(setSettings);
  }, [store]);

  // Pool roster, for the commissioner's "enter picks for…" override.
  const [members, setMembers] = useState<PoolProfile[]>([]);
  useEffect(() => {
    if (profile.isCommissioner) store.getMembers().then(setMembers);
  }, [store, profile.isCommissioner]);

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

  // The whole slate hard-locks at the week's first kickoff — after that no
  // picks can be added or changed (the entries trigger enforces the same
  // rule server-side; only a commissioner override gets past it).
  const picksLockAt = useMemo(() => {
    if (!slate?.published || slate.games.length === 0) return null;
    const kicks = slate.games
      .map((g) => gamesById.get(g.gameId)?.date)
      .filter((d): d is string => !!d)
      .sort();
    return kicks[0] ? new Date(kicks[0]) : null;
  }, [slate, gamesById]);
  const picksLocked = useMemo(() => {
    if (!slate?.published) return false;
    if (picksLockAt && now >= picksLockAt.getTime()) return true;
    return slate.games.some((g) => {
      const r = results[g.gameId];
      return !!r && r.state !== 'pre';
    });
  }, [slate, picksLockAt, now, results]);

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

  // Pre-lock, spreads float with the market: overlay ESPN's current lines
  // for display (grading always uses the stored, locked numbers).
  const [liveLines, setLiveLines] = useState<Record<string, number>>({});
  useEffect(() => {
    setLiveLines({});
    if (!slate || slate.pickType === 'su' || slate.spreadsLockedAt || slate.games.length === 0) return;
    let cancelled = false;
    const load = async () => {
      if (document.hidden) return;
      const r = await fetchWeekScoreboard(season.season, week);
      if (cancelled) return;
      const lines: Record<string, number> = {};
      for (const g of slate.games) {
        const s = r[g.gameId]?.odds?.spread;
        if (s != null) lines[g.gameId] = s;
      }
      setLiveLines(lines);
    };
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [slate, week]);

  const displaySlate = useMemo<WeekSlate | null>(() => {
    if (!slate || Object.keys(liveLines).length === 0) return slate;
    return {
      ...slate,
      games: slate.games.map((g) =>
        liveLines[g.gameId] != null ? { ...g, homeSpread: liveLines[g.gameId] } : g,
      ),
    };
  }, [slate, liveLines]);

  // Monday lock: if this (commissioner) browser is the first to notice the
  // deadline passed, snapshot ESPN's lines into the slate and stamp it
  // locked. A scheduled Edge Function does the same server-side, so this is
  // just the fastest path — both are idempotent (locked slates are skipped).
  useEffect(() => {
    if (!profile.isCommissioner || !slate || slate.pickType === 'su' || slate.spreadsLockedAt) return;
    if (slate.games.length === 0) return;
    const kicks = slate.games
      .map((g) => gamesById.get(g.gameId)?.date)
      .filter((d): d is string => !!d)
      .sort();
    if (kicks.length === 0 || Date.now() < spreadLockTime(kicks[0]).getTime()) return;
    let cancelled = false;
    (async () => {
      const r = await fetchWeekScoreboard(season.season, week);
      if (cancelled) return;
      const games = slate.games.map((g) => {
        const s = r[g.gameId]?.odds?.spread;
        return s != null ? { ...g, homeSpread: s } : g;
      });
      handleSlateSave({
        ...slate,
        games,
        spreadsLockedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slate, profile, week, gamesById]);

  // Whose sheet the Picks tab is editing: yours, or — commissioner only —
  // any member's (for picks texted in by people who forgot). Commissioner
  // edits of OTHER sheets bypass the slate lock; their own never does.
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [weekIndex]);
  const editingMember =
    profile.isCommissioner && editingId && editingId !== profile.playerId
      ? (members.find((m) => m.playerId === editingId) ?? null)
      : null;
  const overriding = editingMember != null;
  const activeProfile = editingMember ?? profile;

  const activeEntry = useMemo<PoolEntry>(() => {
    const existing = entries.find((e) => e.playerId === activeProfile.playerId);
    return (
      existing ?? {
        playerId: activeProfile.playerId,
        playerName: activeProfile.playerName,
        picks: {},
        tiebreaker: null,
        updatedAt: '',
      }
    );
  }, [entries, activeProfile]);

  const saveActiveEntry = (mutate: (entry: PoolEntry) => PoolEntry) => {
    const next = { ...mutate(activeEntry), updatedAt: new Date().toISOString() };
    setEntries((prev) => {
      const others = prev.filter((e) => e.playerId !== next.playerId);
      return [...others, next];
    });
    store.saveEntry(season.season, week.seasonType, week.week, next).catch((err) => {
      alert(
        err instanceof Error && err.message.includes('locked')
          ? 'Too late — picks are locked for this week (first game kicked off).'
          : `Couldn’t save the pick: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refresh();
    });
  };

  const handlePick = (gameId: string, side: PickSide) => {
    const game = gamesById.get(gameId);
    if (!game || !slate?.published) return;
    if (!overriding && (picksLocked || isGameLocked(game, results[gameId]))) return;
    saveActiveEntry((entry) => {
      const picks = { ...entry.picks };
      if (picks[gameId] === side) delete picks[gameId];
      else picks[gameId] = side;
      return { ...entry, picks };
    });
  };

  const handleTiebreaker = (home: number | null, away: number | null) => {
    if (!overriding && picksLocked) return;
    saveActiveEntry((entry) => ({
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

  const handleSettingsSave = (s: PoolSettings) => {
    setSettings(s);
    store.saveSettings(s).catch((err) => {
      alert(`Couldn’t save settings: ${err instanceof Error ? err.message : 'unknown error'}`);
      store.getSettings().then(setSettings);
    });
  };

  const slateGameIds = slate?.published ? slate.games.map((g) => g.gameId) : [];
  const pickedCount = slateGameIds.filter((id) => activeEntry.picks[id]).length;
  const allPicked = slateGameIds.length > 0 && pickedCount === slateGameIds.length;
  const tiebreakerSet = activeEntry.tiebreaker != null;
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
          <>
            {profile.isCommissioner && members.length > 1 && (
              <div className="commish-bar">
                <label className="commish-label">
                  Entering picks for
                  <select
                    value={activeProfile.playerId}
                    onChange={(e) => setEditingId(e.target.value)}
                  >
                    {[profile, ...members.filter((m) => m.playerId !== profile.playerId)].map(
                      (m) => (
                        <option key={m.playerId} value={m.playerId}>
                          {m.playerId === profile.playerId
                            ? `${profile.playerName} (you)`
                            : m.playerName}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                {overriding && (
                  <span className="commish-note">
                    Commissioner override — the lock doesn’t apply here. Only enter picks the
                    player sent you before kickoff.
                  </span>
                )}
              </div>
            )}
            <PickSheet
              week={week}
              slate={displaySlate}
              entry={activeEntry}
              results={results}
              coverOdds={coverOdds}
              picksLockAt={picksLockAt}
              picksLocked={picksLocked}
              overriding={overriding}
              onPick={handlePick}
              onTiebreaker={handleTiebreaker}
            />
          </>
        )}
        {tab === 'board' && (
          <ScoreboardTab
            week={week}
            slate={displaySlate}
            entries={entries}
            results={results}
            coverOdds={coverOdds}
            picksLocked={picksLocked}
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
            onSaveSettings={handleSettingsSave}
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
                    : `${pickedCount}/${slateGameIds.length} picks saved${tiebreakerSet ? '' : ' — don’t forget the tiebreaker'}. You can change them until the first game kicks off.`,
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
