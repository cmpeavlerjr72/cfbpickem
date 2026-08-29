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
import { MembersTab } from './components/MembersTab';
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
/** The commissioner tab holds two views; a sub-toggle keeps the phone nav to four tabs. */
type CommishView = 'slate' | 'members';

interface AppProps {
  store: PoolStore;
  profile: PoolProfile;
  inviteCode?: string;
  poolName?: string;
  onSignOut?: () => void;
  /** Back to the league dashboard (multi-league accounts). */
  onSwitchLeague?: () => void;
}

export default function App({
  store,
  profile,
  inviteCode,
  poolName,
  onSignOut,
  onSwitchLeague,
}: AppProps) {
  const [settings, setSettings] = useState<PoolSettings>(() =>
    poolName ? { ...DEFAULT_SETTINGS, name: poolName } : DEFAULT_SETTINGS,
  );
  const [tab, setTab] = useState<Tab>('picks');
  const [commishView, setCommishView] = useState<CommishView>('slate');
  const [weekIndex, setWeekIndex] = useState(() => defaultWeekIndex(season.weeks));
  const week = season.weeks[weekIndex];
  const [slate, setSlate] = useState<WeekSlate | null>(null);
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [coverOdds, setCoverOdds] = useState<Record<string, CoverOdds>>({});
  const results = useWeekResults(season.season, week);

  // Ticks every 30s so a game flips to locked at its own kickoff without a
  // reload (live-results polling flips it too, whichever lands first).
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

  // Picks lock PER GAME at that game's own kickoff (owner decision
  // 2026-08-29, replacing the old whole-slate freeze at the week's first
  // kickoff). A member can keep filling in later games after early ones
  // start. The enforce_pick_locks trigger enforces the same per-game rule
  // server-side; only a commissioner writing ANOTHER member's entry is
  // exempt.
  const lockedGameIds = useMemo(() => {
    const locked = new Set<string>();
    if (!slate?.published) return locked;
    for (const sg of slate.games) {
      const game = gamesById.get(sg.gameId);
      // isGameLocked reads Date.now() itself; `now` is in the dep list so
      // this recomputes on the 30s tick as well as on fresh live results.
      if (game && isGameLocked(game, results[sg.gameId])) locked.add(sg.gameId);
    }
    return locked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slate, gamesById, results, now]);

  // The tiebreaker follows the TIEBREAKER GAME's kickoff, not the slate's.
  const tiebreakerGameId = useMemo(
    () => slate?.games.find((g) => g.isTiebreaker)?.gameId ?? null,
    [slate],
  );
  const tiebreakerLocked = tiebreakerGameId != null && lockedGameIds.has(tiebreakerGameId);

  // Kickoff of the next game still open for picks (null once all have kicked).
  const nextLockAt = useMemo(() => {
    if (!slate?.published) return null;
    const upcoming = slate.games
      .filter((g) => !lockedGameIds.has(g.gameId))
      .map((g) => gamesById.get(g.gameId)?.date)
      .filter((d): d is string => !!d)
      .sort();
    return upcoming[0] ? new Date(upcoming[0]) : null;
  }, [slate, gamesById, lockedGameIds]);

  // Scoreboard reveal is still a single boolean on that tab (owned elsewhere):
  // true once ANY slate game has kicked, which is what the old whole-slate
  // lock meant. The week_entries RPC now returns opponents' picks filtered to

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
  // edits of OTHER sheets bypass every lock; their own sheet never does.
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
          ? 'Too late — that game has already kicked off. Each game locks at its own kickoff.'
          : `Couldn’t save the pick: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refresh();
    });
  };

  const handlePick = (gameId: string, side: PickSide) => {
    const game = gamesById.get(gameId);
    if (!game || !slate?.published) return;
    if (!overriding && lockedGameIds.has(gameId)) return;
    saveActiveEntry((entry) => {
      const picks = { ...entry.picks };
      if (picks[gameId] === side) delete picks[gameId];
      else picks[gameId] = side;
      return { ...entry, picks };
    });
  };

  const handleTiebreaker = (home: number | null, away: number | null) => {
    if (!overriding && tiebreakerLocked) return;
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
              {onSwitchLeague && (
                <button type="button" className="signout-btn" onClick={onSwitchLeague}>
                  Leagues
                </button>
              )}
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
                    Commissioner override — kickoff locks don’t apply here. Only enter picks the
                    player sent you before that game kicked off.
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
              lockedGameIds={lockedGameIds}
              tiebreakerLocked={tiebreakerLocked}
              nextLockAt={nextLockAt}
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
            currentPlayerId={profile.playerId}
            isCommissioner={profile.isCommissioner}
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
          <>
            <div className="standings-toggle commish-toggle">
              <button
                type="button"
                className={commishView === 'slate' ? 'active' : ''}
                onClick={() => setCommishView('slate')}
              >
                Slate
              </button>
              <button
                type="button"
                className={commishView === 'members' ? 'active' : ''}
                onClick={() => setCommishView('members')}
              >
                Members &amp; dues
              </button>
            </div>
            {commishView === 'slate' ? (
              <SlateBuilder
                week={week}
                slate={slate}
                settings={settings}
                season={season.season}
                inviteCode={inviteCode}
                onSave={handleSlateSave}
                onSaveSettings={handleSettingsSave}
              />
            ) : (
              <MembersTab store={store} currentPlayerId={profile.playerId} />
            )}
          </>
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
                    : `${pickedCount}/${slateGameIds.length} picks saved${tiebreakerSet ? '' : ' — don’t forget the tiebreaker'}. Each game stays open until it kicks off, so you can still fill in the rest.`,
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
