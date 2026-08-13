// Commissioner tools: choose the week's slate games, enter the Monday
// spreads, mark the GameDay tiebreaker, and publish (which locks spreads).

import { useEffect, useMemo, useState } from 'react';
import type { Game, WeekData } from '../types';
import type { WeekResults } from '../results';
import { fetchWeekScoreboard } from '../results';
import type { PoolSettings, SlateGame, WeekSlate } from '../pool/types';
import { formatSpread } from '../pool/types';

/** Monday (00:00 local) of the week containing the slate's first kickoff. */
function mondayOfWeek(week: WeekData): Date {
  const first = Math.min(...week.games.map((g) => new Date(g.date).getTime()));
  const d = new Date(first);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}

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
}

interface DraftGame {
  homeSpread: string; // raw input text; parsed on publish
  isTiebreaker: boolean;
}

export function SlateBuilder({ week, slate, settings, season, inviteCode, onSave }: SlateBuilderProps) {
  const [draft, setDraft] = useState<Map<string, DraftGame>>(new Map());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [espn, setEspn] = useState<WeekResults>({});

  // ESPN's current lines, for one-tap spread prefill on slate day.
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
      next.set(g.gameId, { homeSpread: String(g.homeSpread), isTiebreaker: g.isTiebreaker });
    }
    setDraft(next);
    setError(null);
  }, [slate, week]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  const published = slate?.published ?? false;
  const weekStarted = week.games.some((g) => new Date(g.date).getTime() <= Date.now());
  const monday = mondayOfWeek(week);
  const mondayLabel = monday.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

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
      } else if (next.size < settings.slateSize) {
        // Prefill with ESPN's current line (home POV) when it has one.
        const line = espn[gameId]?.odds?.spread;
        next.set(gameId, {
          homeSpread: line != null ? String(line) : '',
          isTiebreaker: false,
        });
      }
      return next;
    });
  };

  const setSpread = (gameId: string, value: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      const cur = next.get(gameId);
      if (cur) next.set(gameId, { ...cur, homeSpread: value });
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
      const spread = parseFloat(d.homeSpread);
      if (publish && !Number.isFinite(spread)) {
        setError(`Missing spread for ${shortMatchup(gamesById.get(gameId)!)}`);
        return null;
      }
      games.push({
        gameId,
        homeSpread: Number.isFinite(spread) ? spread : 0,
        isTiebreaker: d.isTiebreaker,
      });
    }
    if (publish) {
      if (games.length !== settings.slateSize) {
        setError(`Pick exactly ${settings.slateSize} games (${games.length} selected).`);
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
      published: publish,
      spreadsLockedAt: publish ? (slate?.spreadsLockedAt ?? new Date().toISOString()) : null,
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
    if (!confirm('Unpublish the slate? Spreads are supposed to be locked as of Monday.')) return;
    onSave({ ...slate, published: false, spreadsLockedAt: null, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="slate-builder">
      <div className="slate-status-card">
        <div className="slate-status-top">
          <h2 className="slate-status-title">
            {week.label} slate · {draft.size}/{settings.slateSize} games
          </h2>
          {published ? (
            <span className="slate-badge published">Published · spreads locked</span>
          ) : (
            <span className="slate-badge draft">Draft</span>
          )}
        </div>
        <p className="slate-status-note">
          Use the lines as of Monday, {mondayLabel} — once you publish, spreads are frozen for the
          week. Spread is entered for the <strong>home</strong> team (home favored = negative,
          e.g. −6.5).
        </p>
        {inviteCode && (
          <p className="slate-invite">
            Invite code: <strong>{inviteCode}</strong> — share it so people can join the pool.
          </p>
        )}
        {error && <p className="slate-error">{error}</p>}
        <div className="slate-actions">
          {!published && (
            <>
              <button type="button" className="ghost-btn" onClick={saveDraft} disabled={draft.size === 0}>
                Save draft
              </button>
              <button type="button" className="submit-btn" onClick={publish} disabled={draft.size === 0}>
                Publish &amp; lock spreads
              </button>
            </>
          )}
          {published && !weekStarted && (
            <button type="button" className="ghost-btn" onClick={unpublish}>
              Unpublish to edit
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
              const parsed = parseFloat(d.homeSpread);
              const awayLine = Number.isFinite(parsed) ? formatSpread(-parsed) : '—';
              return (
                <div key={game.id} className="slate-row">
                  <div className="slate-row-main">
                    <span className="slate-row-matchup">{shortMatchup(game)}</span>
                    <span className="slate-row-time">{kickoffLabel(game)}</span>
                  </div>
                  <div className="slate-row-controls">
                    <label className="slate-spread">
                      <span>{game.home?.abbrev ?? 'Home'}</span>
                      <input
                        type="number"
                        step="0.5"
                        inputMode="decimal"
                        placeholder="-6.5"
                        value={d.homeSpread}
                        disabled={published}
                        onChange={(e) => setSpread(game.id, e.target.value)}
                      />
                    </label>
                    <span className="slate-away-line">
                      {game.away?.abbrev ?? 'Away'} {awayLine}
                    </span>
                    {!published && espn[game.id]?.odds?.spread != null && (
                      <button
                        type="button"
                        className="espn-line-btn"
                        title={`Use ESPN's line${espn[game.id]!.odds!.provider ? ` (${espn[game.id]!.odds!.provider})` : ''}`}
                        onClick={() => setSpread(game.id, String(espn[game.id]!.odds!.spread))}
                      >
                        ESPN: {espn[game.id]!.odds!.details ?? formatSpread(espn[game.id]!.odds!.spread!)}
                      </button>
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
            {candidates.slice(0, 40).map((game) => (
              <button
                key={game.id}
                type="button"
                className="slate-candidate"
                disabled={draft.size >= settings.slateSize}
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
                <span className="slate-row-time">{kickoffLabel(game)}</span>
              </button>
            ))}
            {candidates.length > 40 && (
              <p className="slate-more">Search to narrow down — {candidates.length - 40} more games this week.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
