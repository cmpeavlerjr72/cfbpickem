// Live scoreboard for the week's slate: game state (clock, possession, last
// play) ordered live → upcoming → final, plus one compact picks grid — a row
// per member, a column per game, each pick shown as the picked team's LOGO.
//
// Picks reveal PER GAME, not per slate: the `week_entries` RPC returns another
// member's pick for a game only once that game has kicked off. So a missing
// pick key means "not revealed yet" before kickoff and "no pick made" after
// it — never an error. Your own row and the commissioner's view are always
// complete, so a missing key there is always a real no-pick.

import { useMemo, useState } from 'react';
import type { Game, Team, WeekData } from '../types';
import type { GameResult, WeekResults } from '../results';
import { isGameLocked } from '../results';
import type { CoverOdds, PickSide, PoolEntry, SlateGame, WeekSlate } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';
import { AtsGameCard } from './AtsGameCard';
import type { GamecastSituation } from '../gamecast';
import { FieldStrip, LiveGamePanel, type TeamBits } from './LiveGamecast';

/** Field-visual bits built from the ESPN-joined Team objects — the join is
 * by id everywhere, never by name (see types.ts). Team.color already
 * carries its '#' prefix in this app's data. */
function gamecastBits(game: Game): TeamBits {
  return {
    homeAbbrev: game.home?.abbrev ?? undefined,
    awayAbbrev: game.away?.abbrev ?? undefined,
    homeColor: game.home?.color ?? undefined,
    awayColor: game.away?.color ?? undefined,
    homeId: game.home?.id ?? undefined,
    awayId: game.away?.id ?? undefined,
    homeLogo: game.home?.logo ?? undefined,
    awayLogo: game.away?.logo ?? undefined,
  };
}

function gamecastSituation(result: GameResult): GamecastSituation {
  return {
    yardLine: result.yardLine,
    down: result.down,
    distance: result.distance,
    downDistanceText: result.downDistance,
    possessionId: result.possessionTeamId,
    isRedZone: result.isRedZone,
    lastPlayText: result.lastPlay,
    attackDir: result.attackDir,
    homeWinPct: result.homeWinPct,
  };
}

function stateRank(result?: GameResult): number {
  if (result?.state === 'in') return 0;
  if (!result || result.state === 'pre') return 1;
  return 2;
}

interface ScoreboardTabProps {
  week: WeekData;
  slate: WeekSlate | null;
  entries: PoolEntry[];
  results: WeekResults;
  coverOdds: Record<string, CoverOdds>;
  currentPlayerId: string;
  isCommissioner: boolean;
}

export function ScoreboardTab({
  week,
  slate,
  entries,
  results,
  coverOdds,
  currentPlayerId,
  isCommissioner,
}: ScoreboardTabProps) {
  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  // Gamecast break-out panel: one game open at a time.
  const [openGamecastId, setOpenGamecastId] = useState<string | null>(null);

  if (!slate || !slate.published || slate.games.length === 0) {
    return (
      <div className="results-empty">
        <div className="results-empty-title">No slate for {week.label} yet</div>
        <p>The live scoreboard lights up once the commissioner posts the games.</p>
      </div>
    );
  }

  const items = slate.games
    .map((sg) => ({ sg, game: gamesById.get(sg.gameId) }))
    .filter((x): x is { sg: SlateGame; game: Game } => !!x.game)
    .sort(
      (a, b) =>
        stateRank(results[a.game.id]) - stateRank(results[b.game.id]) ||
        a.game.date.localeCompare(b.game.date),
    );

  const myEntry = entries.find((e) => e.playerId === currentPlayerId);

  return (
    <div className="scoreboard">
      <PicksGrid
        items={items}
        entries={entries}
        results={results}
        isCommissioner={isCommissioner}
        currentPlayerId={currentPlayerId}
      />
      {items.map(({ sg, game }) => {
        const result = results[game.id];
        const live = result?.state === 'in';
        return (
          <div key={game.id} className={`scoreboard-item${live ? ' live' : ''}`}>
            <AtsGameCard
              game={game}
              slateGame={sg}
              pickType={slate.pickType ?? 'ats'}
              result={result}
              locked={isGameLocked(game, result)}
              readOnly
              pickedSide={myEntry?.picks[game.id] ?? null}
              coverOdds={coverOdds[game.id] ?? null}
            />
            {live && (
              <>
                <LiveSituation game={game} result={result!} />
                <GamecastOpener
                  open={openGamecastId === game.id}
                  onToggle={() =>
                    setOpenGamecastId((cur) => (cur === game.id ? null : game.id))
                  }
                />
                {openGamecastId === game.id && (
                  <LiveGamePanel
                    eventId={game.id}
                    isLive
                    situation={gamecastSituation(result!)}
                    bits={gamecastBits(game)}
                    pickType={slate.pickType ?? 'ats'}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LiveSituation({ game, result }: { game: Game; result: GameResult }) {
  const hasSituation =
    result.possessionTeamId != null || result.yardLine != null || !!result.downDistance;
  if (!hasSituation && !result.lastPlay) return null;
  return (
    <div className={`live-situation${result.isRedZone ? ' redzone' : ''}`}>
      {hasSituation && (
        <FieldStrip situation={gamecastSituation(result)} bits={gamecastBits(game)} condensed />
      )}
      {result.lastPlay && <span className="live-lastplay">{result.lastPlay}</span>}
    </div>
  );
}

/**
 * The way into the live gamecast panel. Deliberately reads as an INFO control
 * — chart glyph, an explicit label, a one-line "what's inside" hint and a
 * chevron on the right — rather than a bare caret that could be mistaken for
 * a tray/collapse handle for something else on the card.
 */
function GamecastOpener({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`gamecast-open${open ? ' open' : ''}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="gamecast-open-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round">
          <path d="M2 13.4h12" />
          <path d="M4.4 13.4V8.6" />
          <path d="M8 13.4V4.4" />
          <path d="M11.6 13.4V6.8" />
        </svg>
      </span>
      <span className="gamecast-open-text">
        <span className="gamecast-open-label">
          <span className="gamecast-live-dot" aria-hidden="true" />
          {open ? 'Hide live gamecast' : 'Live gamecast'}
        </span>
        <span className="gamecast-open-hint">
          {open ? 'Tap to close' : 'Drive chart, win probability, last plays'}
        </span>
      </span>
      <span className="gamecast-open-chevron" aria-hidden="true">
        {open ? '▲' : '▼'}
      </span>
    </button>
  );
}

/* ---------- Picks grid ---------- */

type PickTone = 'neutral' | 'win' | 'loss' | 'push' | 'ahead' | 'behind';

/** One game column, with everything the cells need precomputed once. */
interface GridColumn {
  sg: SlateGame;
  game: Game;
  result?: GameResult;
  /** Has this game started? Also the reveal gate for other members' picks. */
  kicked: boolean;
  live: boolean;
  final: boolean;
  started: boolean;
  /** Home cover margin, live or final (null before any score). */
  margin: number | null;
}

/** Short, always-safe text identity for a team — never rely on the logo alone. */
function teamLabel(team: Team | null | undefined, side: PickSide): string {
  const abbrev = team?.abbrev?.trim();
  if (abbrev) return abbrev;
  const school = team?.school?.trim();
  if (school) return school.slice(0, 4).toUpperCase();
  return side === 'home' ? 'HOME' : 'AWAY';
}

function pickTone(side: PickSide, col: GridColumn): PickTone {
  const grade = gradeAts(side, col.sg, col.result);
  if (grade === 'win') return 'win';
  if (grade === 'loss') return 'loss';
  if (grade === 'push') return 'push';
  if (col.started && col.margin != null) {
    if (col.margin === 0) return 'push';
    return (side === 'home') === col.margin > 0 ? 'ahead' : 'behind';
  }
  return 'neutral';
}

const TONE_WORD: Record<PickTone, string> = {
  neutral: '',
  win: 'win',
  loss: 'loss',
  push: 'push',
  ahead: 'ahead',
  behind: 'behind',
};

/** Final-state glyph so grading never rests on colour alone. */
const TONE_GLYPH: Partial<Record<PickTone, string>> = {
  win: '✓',
  loss: '✗',
  push: '=',
};

/** The picked team's logo, with the abbrev as alt text and as the rendered
 * fallback when the image is missing or fails to load. */
function PickMark({ team, side, title }: { team: Team | null; side: PickSide; title: string }) {
  const [broken, setBroken] = useState(false);
  const label = teamLabel(team, side);
  if (!team?.logo || broken) {
    return (
      <span className="pg-mark pg-mark-text" title={title}>
        {label}
      </span>
    );
  }
  return (
    <img
      className="pg-mark"
      src={team.logo}
      alt={label}
      title={title}
      width={22}
      height={22}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

interface PicksGridProps {
  items: { sg: SlateGame; game: Game }[];
  entries: PoolEntry[];
  results: WeekResults;
  isCommissioner: boolean;
  currentPlayerId: string;
}

function PicksGrid({
  items,
  entries,
  results,
  isCommissioner,
  currentPlayerId,
}: PicksGridProps) {
  const cols: GridColumn[] = items.map(({ sg, game }) => {
    const result = results[game.id];
    return {
      sg,
      game,
      result,
      kicked: isGameLocked(game, result),
      live: result?.state === 'in',
      final: !!result?.completed,
      started: !!result && result.state !== 'pre',
      margin: result ? coverMargin(sg.homeSpread, result) : null,
    };
  });

  if (entries.length === 0 || cols.length === 0) return null;

  const tbCol = cols.find((c) => c.sg.isTiebreaker) ?? null;
  const kickedCount = cols.filter((c) => c.kicked).length;
  const sheets = `${entries.length} ${entries.length === 1 ? 'sheet' : 'sheets'} in`;
  const note =
    isCommissioner && kickedCount < cols.length
      ? `${sheets} · visible to you as commissioner`
      : kickedCount < cols.length
        ? `${sheets} · each pick shows once its game kicks off`
        : sheets;
  const anyHidden =
    !isCommissioner &&
    kickedCount < cols.length &&
    entries.some((e) => e.playerId !== currentPlayerId);

  return (
    <section className="picks-board" aria-label="Everyone’s picks">
      <div className="picks-board-head">
        <h3 className="picks-board-title">Picks</h3>
        <span className="picks-board-note">{note}</span>
      </div>
      <div className="picks-board-scroll">
        <table className="picks-grid">
          <thead>
            <tr>
              <th scope="col" className="pg-corner">
                Member
              </th>
              {cols.map((col) => {
                const away = teamLabel(col.game.away, 'away');
                const home = teamLabel(col.game.home, 'home');
                const state = col.live ? ' · live' : col.final ? ' · final' : '';
                return (
                  <th
                    key={col.game.id}
                    scope="col"
                    className={`pg-col${col.live ? ' live' : ''}${col.final ? ' final' : ''}${
                      col.sg.isTiebreaker ? ' tb' : ''
                    }`}
                    title={`${col.game.away?.school ?? away} at ${
                      col.game.home?.school ?? home
                    }${state}${col.sg.isTiebreaker ? ' · GameDay tiebreaker' : ''}`}
                  >
                    <span className="pg-col-team">{away}</span>
                    <span className="pg-col-team pg-col-home">{home}</span>
                  </th>
                );
              })}
              {tbCol && (
                <th
                  scope="col"
                  className="pg-tb-col"
                  title="GameDay tiebreaker guess (away–home)"
                >
                  TB
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const mine = entry.playerId === currentPlayerId;
              // Own sheet and the commissioner's view are complete, so a
              // missing key there is a real no-pick, not a hidden one.
              const seesAll = mine || isCommissioner;
              let wins = 0;
              let losses = 0;
              let pushes = 0;
              for (const col of cols) {
                const side = entry.picks[col.game.id];
                if (!side) continue;
                const grade = gradeAts(side, col.sg, col.result);
                if (grade === 'win') wins++;
                else if (grade === 'loss') losses++;
                else if (grade === 'push') pushes++;
              }
              const played = wins + losses + pushes;
              const record = pushes > 0 ? `${wins}-${losses}-${pushes}` : `${wins}-${losses}`;
              return (
                <tr key={entry.playerId} className={`pg-row${mine ? ' me' : ''}`}>
                  <th scope="row" className="pg-name">
                    <span className="pg-player" title={entry.playerName}>
                      {entry.playerName}
                    </span>
                    {played > 0 && (
                      <span className="pg-record" title="Record so far this week">
                        {record}
                      </span>
                    )}
                  </th>
                  {cols.map((col) => {
                    const side = entry.picks[col.game.id];
                    if (!side) {
                      const known = seesAll || col.kicked;
                      return (
                        <td key={col.game.id} className={`pg-cell${known ? ' empty' : ' hidden'}`}>
                          {known ? (
                            <span
                              className="pg-empty"
                              title={`${entry.playerName}: no pick`}
                              aria-label="No pick"
                            >
                              —
                            </span>
                          ) : (
                            <span
                              className="pg-dot"
                              title="Hidden until this game kicks off"
                              aria-label="Hidden until kickoff"
                            />
                          )}
                        </td>
                      );
                    }
                    const team = side === 'home' ? col.game.home : col.game.away;
                    const tone = pickTone(side, col);
                    const word = TONE_WORD[tone];
                    const glyph = col.final ? TONE_GLYPH[tone] : undefined;
                    const title = `${entry.playerName}: ${
                      team?.school ?? teamLabel(team, side)
                    }${word ? ` · ${word}` : ''}`;
                    return (
                      <td key={col.game.id} className={`pg-cell ${tone}`}>
                        <PickMark team={team} side={side} title={title} />
                        {glyph && (
                          <span className="pg-grade" aria-hidden="true">
                            {glyph}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {tbCol && (
                    <td className="pg-tb">
                      {entry.tiebreaker ? (
                        <span
                          title={`${entry.playerName}: ${
                            tbCol.game.away?.school ?? 'away'
                          } ${entry.tiebreaker.away} – ${tbCol.game.home?.school ?? 'home'} ${
                            entry.tiebreaker.home
                          }`}
                        >
                          {entry.tiebreaker.away}–{entry.tiebreaker.home}
                        </span>
                      ) : seesAll || tbCol.kicked ? (
                        <span className="pg-empty" aria-label="No tiebreaker">
                          —
                        </span>
                      ) : (
                        <span
                          className="pg-dot"
                          title="Hidden until this game kicks off"
                          aria-label="Hidden until kickoff"
                        />
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(anyHidden || kickedCount > 0) && (
        <div className="picks-legend">
          {anyHidden && (
            <span className="picks-legend-item">
              <span className="pg-dot" aria-hidden="true" /> hidden until kickoff
            </span>
          )}
          {kickedCount > 0 && (
            <span className="picks-legend-item">
              <span className="pg-empty" aria-hidden="true">
                —
              </span>{' '}
              no pick
            </span>
          )}
        </div>
      )}
    </section>
  );
}
