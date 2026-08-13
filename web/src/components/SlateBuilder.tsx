// Commissioner tools: pool settings (pick style, target size), choose the
// week's slate games, mark the GameDay tiebreaker, and publish. Spreads are
// NOT editable — they track ESPN's line and freeze automatically at Monday
// 12:00 AM ET of game week (see pool/spreads.ts).

import { useEffect, useMemo, useState } from 'react';
import type { Game, WeekData } from '../types';
import type { WeekResults } from '../results';
import { fetchWeekScoreboard } from '../results';
import type { PoolSettings, SlateGame, WeekSlate } from '../pool/types';
import { formatSpread } from '../pool/types';
import { spreadLockTime } from '../pool/spreads';

function shortMatchup(game: Game): string {
  const away = game.away?.abbrev ?? game.away?.school ?? 'TBD';
  const home = game.home?.abbrev ?? game.home?.school ?? 'TBD';
  return `${away} ${game.neutralSite ? 'vs' : '@'} ${home}`;
}

function kickoffLabel(game: Game): string {
  return new Date(game.date).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface SlateBuilderProps {
  week: WeekData;
  slate: WeekSlate | null;
  settings: PoolSettings;
  season: number;
  inviteCode?: string;
  onSave: (slate: WeekSlate) => void;
  onSaveSettings: (settings: PoolSettings) => void;
}

interface DraftGame {
  storedSpread: number | null; // last saved home-POV line
  isTiebreaker: boolean;
}

export function SlateBuilder({
  week,
  slate,
  settings,
  season,
  inviteCode,
  onSave,
  onSaveSettings,
}: SlateBuilderProps) {
  const [draft, setDraft] = useState<Map<string, DraftGame>>(new Map());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [espn, setEspn] = useState<WeekResults>({});

  // Current ESPN lines — shown live until the Monday lock.
  useEffect(() => {
    let cancelled = false;
    setEspn({});
    fetchWeekScoreboard(season, week).then((r) => {
      if (!cancelled) setEspn(r);
    });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  useEffect(() => {
    const next = new Map<string, DraftGame>();
    for (const g of slate?.games ?? []) {
      next.set(g.gameId, { storedSpread: g.homeSpread, isTiebreaker: g.isTiebreaker });
    }
    setDraft(next);
    setError(null);
  }, [slate, week]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  const ats = settings.pickType === 'ats';
  const published = slate?.published ?? false;
  const weekStarted = week.games.some((g) => new Date(g.date).getTime() <= Date.now());
  const firstKick = week.games.length
    ? week.games.reduce((min, g) => (g.date < min ? g.date : min), week.games[0].date)
    : null;
  const lockAt = firstKick ? spreadLockTime(firstKick) : null;
  const linesLocked = !!slate?.spreadsLockedAt || (!!lockAt && Date.now() >= lockAt.getTime());
  const lockLabel = lockAt
    ? lockAt.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';

  /** Best-known line for a game: locked slate value, else live ESPN. */
  const lineFor = (gameId: string): number | null => {
    if (linesLocked) return draft.get(gameId)?.storedSpread ?? null;
    return espn[gameId]?.odds?.spread ?? draft.get(gameId)?.storedSpread ?? null;
  };

  const selected = [...draft.keys()]
    .map((id) => gamesById.get(id))
    .filter((g): g is Game => !!g)
    .sort((a, b) => a.date.localeCompare(b.date));

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return week.games
      .filter((g) => g.home && g.away && !draft.has(g.id))
      .filter(
        (g) =>
          !q ||
          g.home!.school.toLowerCase().includes(q) ||
          g.away!.school.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Ranked matchups first — those are the slate candidates.
        const aRank = Math.min(a.home!.rank ?? 99, a.away!.rank ?? 99);
        const bRank = Math.min(b.home!.rank ?? 99, b.away!.rank ?? 99);
        return aRank - bRank || a.date.localeCompare(b.date);
      });
  }, [week, draft, filter]);

  const toggleGame = (gameId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.set(gameId, {
          storedSpread: espn[gameId]?.odds?.spread ?? null,
          isTiebreaker: false,
        });
      }
      return next;
    });
  };

  const setTiebreaker = (gameId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const [id, g] of next) next.set(id, { ...g, isTiebreaker: id === gameId });
      return next;
    });
  };

  const buildSlate = (publish: boolean): WeekSlate | null => {
    const games: SlateGame[] = [];
    for (const [gameId, d] of draft) {
      // Until the Monday lock, saving refreshes each game to ESPN's current
      // line; after the lock the stored number is the number.
      const live = espn[gameId]?.odds?.spread;
      const homeSpread = ats
        ? (linesLocked ? (d.storedSpread ?? live ?? 0) : (live ?? d.storedSpread ?? 0))
        : 0;
      games.push({ gameId, homeSpread, isTiebreaker: d.isTiebreaker });
    }
    if (publish) {
      if (games.length === 0) {
        setError('Add at least one game to the slate.');
        return null;
      }
      if (!games.some((g) => g.isTiebreaker)) {
        setError('Mark one game as the GameDay tiebreaker.');
        return null;
      }
    }
    setError(null);
    return {
      season,
      seasonType: week.seasonType,
      week: week.week,
      games,
      pickType: settings.pickType,
      published: publish,
      spreadsLockedAt: slate?.spreadsLockedAt ?? null,
      updatedAt: new Date().toISOString(),
    };
  };

  const saveDraft = () => {
    const s = buildSlate(false);
    if (s) onSave(s);
  };

  const publish = () => {
    const s = buildSlate(true);
    if (s) onSave(s);
  };

  const unpublish = () => {
    if (!slate) return;
    if (weekStarted) return;
    if (!confirm('Unpublish the slate so you can change the games?')) return;
    onSave({ ...slate, published: false, updatedAt: new Date().toISOString() });
  };

  const countLabel =
    settings.slateSize > 0 && draft.size !== settings.slateSize
      ? `${draft.size} games (target ${settings.slateSize})`
      : `${draft.size} games`;

  return (
    <div className="slate-builder">
      <div className="slate-status-card">
        <h2 className="slate-status-title">Pool settings</h2>
        <div className="pool-settings-row">
          <label className="slate-tb">
            <input
              type="radio"
              name="picktype"
              checked={settings.pickType === 'ats'}
              onChange={() => onSaveSettings({ ...settings, pickType: 'ats' })}
            />
            Against the spread
          </label>
          <label className="slate-tb">
            <input
              type="radio"
              name="picktype"
              checked={settings.pickType === 'su'}
              onChange={() => onSaveSettings({ ...settings, pickType: 'su' })}
            />
            Straight up
          </label>
          <label className="slate-spread">
            <span>Games/week</span>
            <input
              type="number"
              min="1"
              max="40"
              value={settings.slateSize}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n >= 1) {
                  onSaveSettings({ ...settings, slateSize: Math.min(n, 40) });
                }
              }}
            />
          </label>
        </div>
        <p className="slate-status-note">
          Pick style applies to new slates; the games-per-week number is just your target —
          add as many games as you want.
        </p>
        {inviteCode && (
          <p className="slate-invite">
            Invite code: <strong>{inviteCode}</strong> — share it so people can join the pool.
          </p>
        )}
      </div>

      <div className="slate-status-card">
        <div className="slate-status-top">
          <h2 className="slate-status-title">
            {week.label} slate · {countLabel}
          </h2>
          {published ? (
            <span className="slate-badge published">Published</span>
          ) : (
            <span className="slate-badge draft">Draft</span>
          )}
          {ats &&
            (linesLocked ? (
              <span className="slate-badge published">Lines locked</span>
            ) : (
              <span className="slate-badge draft">Lines float until {lockLabel}</span>
            ))}
        </div>
        <p className="slate-status-note">
          {ats ? (
            <>
              Spreads come straight from ESPN — nobody edits them. They move with the market
              until <strong>Monday of game week ({lockLabel})</strong>, then freeze at that
              number for grading. Games with no posted line play as PK unless one appears
              before the lock.
            </>
          ) : (
            <>Straight-up pool — players just pick winners, no spreads.</>
          )}
        </p>
        {error && <p className="slate-error">{error}</p>}
        <div className="slate-actions">
          {!published && (
            <>
              <button type="button" className="ghost-btn" onClick={saveDraft} disabled={draft.size === 0}>
                Save draft
              </button>
              <button type="button" className="submit-btn" onClick={publish} disabled={draft.size === 0}>
                Publish slate
              </button>
            </>
          )}
          {published && !weekStarted && (
            <button type="button" className="ghost-btn" onClick={unpublish}>
              Unpublish to edit games
            </button>
          )}
        </div>
      </div>

      {selected.length > 0 && (
        <section>
          <h2 className="day-header">Slate</h2>
          <div className="slate-selected">
            {selected.map((game) => {
              const d = draft.get(game.id)!;
              const line = lineFor(game.id);
              return (
                <div key={game.id} className="slate-row">
                  <div className="slate-row-main">
                    <span className="slate-row-matchup">{shortMatchup(game)}</span>
                    <span className="slate-row-time">{kickoffLabel(game)}</span>
                  </div>
                  <div className="slate-row-controls">
                    {ats && (
                      <span className="slate-line">
                        {line != null ? (
                          <>
                            {game.home?.abbrev ?? 'Home'}{' '}
                            <strong>{formatSpread(line)}</strong>
                            <em>{linesLocked ? ' · locked' : ' · live'}</em>
                          </>
                        ) : (
                          <>
                            No line yet <em>· plays as PK if none by lock</em>
                          </>
                        )}
                      </span>
                    )}
                    <label className={`slate-tb${d.isTiebreaker ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name="tiebreaker"
                        checked={d.isTiebreaker}
                        disabled={published}
                        onChange={() => setTiebreaker(game.id)}
                      />
                      GameDay TB
                    </label>
                    {!published && (
                      <button
                        type="button"
                        className="slate-remove"
                        onClick={() => toggleGame(game.id)}
                        aria-label="Remove game"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!published && (
        <section>
          <h2 className="day-header">Add games</h2>
          <input
            className="slate-search"
            placeholder="Search teams…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="slate-candidates">
            {candidates.map((game) => (
              <button
                key={game.id}
                type="button"
                className="slate-candidate"
                onClick={() => toggleGame(game.id)}
              >
                <span className="slate-candidate-add">＋</span>
                <span className="slate-row-matchup">
                  {game.away?.rank != null && <em>#{game.away.rank} </em>}
                  {game.away?.school}
                  {game.neutralSite ? ' vs ' : ' at '}
                  {game.home?.rank != null && <em>#{game.home.rank} </em>}
                  {game.home?.school}
                </span>
                {ats && espn[game.id]?.odds?.spread != null && (
                  <span className="slate-away-line">{espn[game.id]!.odds!.details ?? formatSpread(espn[game.id]!.odds!.spread!)}</span>
                )}
                <span className="slate-row-time">{kickoffLabel(game)}</span>
              </button>
            ))}
            <p className="slate-more">
              {candidates.length} {candidates.length === 1 ? 'game' : 'games'} this week
              {filter.trim() ? ' matching your search' : ''} · ranked matchups first
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
