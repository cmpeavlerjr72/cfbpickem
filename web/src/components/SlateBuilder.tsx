// Commissioner tools: pool settings (pick style, target size), choose the
// week's slate games, mark the GameDay tiebreaker, and publish. Spreads are
// NOT editable — they track ESPN's line and freeze automatically at Monday
// 12:00 AM ET of game week (see pool/spreads.ts).

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Game, Team, WeekData } from '../types';
import type { WeekResults } from '../results';
import { fetchWeekScoreboard } from '../results';
import type { PoolSettings, SlateGame, WeekSlate } from '../pool/types';
import { formatSpread } from '../pool/types';
import { spreadLockTime } from '../pool/spreads';
import { TOP25_KEY, buildGameSections } from '../pool/conferences';

/** "#7 ORE" — rank prefix only when the team is ranked. */
function teamLabel(team: Team | null | undefined): string {
  const name = team?.abbrev ?? team?.school ?? 'TBD';
  return team?.rank != null ? `#${team.rank} ${name}` : name;
}

function shortMatchup(game: Game): string {
  return `${teamLabel(game.away)} ${game.neutralSite ? 'vs' : '@'} ${teamLabel(game.home)}`;
}

function kickoffLabel(game: Game): string {
  return new Date(game.date).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Category-section chrome. Inline (not App.css) because this component owns the
// only markup that uses it; the values come from the same index.css variables
// the stylesheet uses. Fold into App.css if these classes get reused elsewhere.
const sx: Record<string, CSSProperties> = {
  sectionList: { display: 'flex', flexDirection: 'column', gap: 8 },
  section: {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 10px 4px 4px',
  },
  sectionToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
    background: 'none',
    border: 'none',
    padding: '8px 6px',
    textAlign: 'left',
    cursor: 'pointer',
    font: 'inherit',
  },
  caret: { color: 'var(--text-dim)', fontSize: 11, width: 12, flex: '0 0 auto' },
  sectionTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)' },
  sectionCount: { fontSize: 12, color: 'var(--text-dim)', marginLeft: 'auto' },
  sectionAll: {
    flex: '0 0 auto',
    background: 'none',
    border: '1.5px solid var(--border)',
    borderRadius: 999,
    color: 'var(--text-dim)',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 10px',
    cursor: 'pointer',
  },
  sectionBody: { padding: '0 10px 10px' },
  candidateOn: {
    borderColor: 'var(--green-border)',
    background: 'var(--green-soft)',
  },
};

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
  // Top 25 opens by default; conference sections start collapsed.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set([TOP25_KEY]));
  // Games/week as local TEXT so the field can be cleared while retyping — the
  // controlled-number pattern made the 1 undeletable (same defect class as the
  // tiebreaker inputs, fixed 2026-08-29). Mobile already worked this way.
  const [sizeText, setSizeText] = useState(String(settings.slateSize));
  useEffect(() => setSizeText(String(settings.slateSize)), [settings.slateSize]);

  useEffect(() => setOpenSections(new Set([TOP25_KEY])), [week]);

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

  // Every playable game this week, bucketed into Top 25 + conference sections.
  // A cross-conference game shows up in both sections — same game id, so
  // selecting it anywhere selects it everywhere and the count stays deduped.
  const sections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const games = week.games
      .filter((g) => g.home && g.away)
      .filter(
        (g) =>
          !q ||
          g.home!.school.toLowerCase().includes(q) ||
          g.away!.school.toLowerCase().includes(q),
      );
    return buildGameSections(games);
  }, [week, filter]);

  const totalCandidates = useMemo(
    () =>
      week.games.filter((g) => {
        if (!g.home || !g.away) return false;
        const q = filter.trim().toLowerCase();
        return (
          !q ||
          g.home.school.toLowerCase().includes(q) ||
          g.away.school.toLowerCase().includes(q)
        );
      }).length,
    [week, filter],
  );

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

  /** Section "Select all" / "Unselect all" — one state update for the group. */
  const setGames = (games: Game[], selected: boolean) => {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const g of games) {
        if (selected) {
          if (!next.has(g.id)) {
            next.set(g.id, {
              storedSpread: espn[g.id]?.odds?.spread ?? null,
              isTiebreaker: false,
            });
          }
        } else {
          next.delete(g.id);
        }
      }
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sizeText}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '');
                setSizeText(digits);
                const n = parseInt(digits, 10);
                if (Number.isFinite(n) && n >= 1) {
                  onSaveSettings({ ...settings, slateSize: Math.min(n, 40) });
                }
              }}
              onBlur={() => setSizeText(String(settings.slateSize))}
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
          <div style={sx.sectionList}>
            {sections.map((section) => {
              const open = openSections.has(section.key);
              const picked = section.games.filter((g) => draft.has(g.id)).length;
              const allPicked = picked === section.games.length;
              return (
                <div key={section.key} style={sx.section}>
                  <div style={sx.sectionHead}>
                    <button
                      type="button"
                      style={sx.sectionToggle}
                      onClick={() => toggleSection(section.key)}
                      aria-expanded={open}
                    >
                      <span style={sx.caret}>{open ? '▾' : '▸'}</span>
                      <span style={sx.sectionTitle}>{section.title}</span>
                      <span style={sx.sectionCount}>
                        {picked} / {section.games.length} selected
                      </span>
                    </button>
                    <button
                      type="button"
                      style={sx.sectionAll}
                      onClick={() => setGames(section.games, !allPicked)}
                    >
                      {allPicked ? 'Unselect all' : 'Select all'}
                    </button>
                  </div>
                  {open && (
                    <div className="slate-candidates" style={sx.sectionBody}>
                      {section.games.map((game) => {
                        const on = draft.has(game.id);
                        return (
                          <button
                            key={game.id}
                            type="button"
                            className="slate-candidate"
                            style={on ? sx.candidateOn : undefined}
                            onClick={() => toggleGame(game.id)}
                            aria-pressed={on}
                          >
                            <span className="slate-candidate-add">{on ? '✓' : '＋'}</span>
                            <span className="slate-row-matchup">
                              {game.away?.rank != null && <em>#{game.away.rank} </em>}
                              {game.away?.school}
                              {game.neutralSite ? ' vs ' : ' at '}
                              {game.home?.rank != null && <em>#{game.home.rank} </em>}
                              {game.home?.school}
                            </span>
                            {ats && espn[game.id]?.odds?.spread != null && (
                              <span className="slate-away-line">
                                {espn[game.id]!.odds!.details ??
                                  formatSpread(espn[game.id]!.odds!.spread!)}
                              </span>
                            )}
                            <span className="slate-row-time">{kickoffLabel(game)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="slate-more">
            {totalCandidates} {totalCandidates === 1 ? 'game' : 'games'} this week
            {filter.trim() ? ' matching your search' : ''} · a game in two conferences is
            listed under both
          </p>
        </section>
      )}
    </div>
  );
}
