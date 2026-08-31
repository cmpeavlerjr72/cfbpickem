// Weekly leaderboard (winner crowned when every slate game is final) and
// season-long standings for the overall prize pool.

import { useEffect, useState } from 'react';
import type { SeasonData } from '../types';
import type { PoolSettings } from '../pool/types';
import type { PoolStore } from '../pool/store';
import type { EntryScore, ScoredWeek, SeasonRow } from '../pool/scoring';
import { countsTowardSeason, seasonStandings } from '../pool/scoring';
import { loadScoredWeeks } from '../pool/scoredWeeks';
import { DEGENERATE_NATION_POOL_ID } from '../pool/degenerate';

function pointsText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Leaderboard display name: the player's real name when they've set one,
 * else their display name. Leaderboards only — every other surface (pick
 * sheets, scoreboard, celebration overlay, commissioner selector) uses
 * playerName directly and should stay that way.
 */
function boardName(x: { realName?: string | null; playerName: string }): string {
  const real = x.realName?.trim();
  return real ? real : x.playerName;
}

/** "✓ 3" / "✗ 12" / "—" — winner pick first, then the total-points distance. */
function tbText(s: EntryScore): string {
  if (s.tiebreakerError == null) return '—';
  // No winner mark only in the tied-TB-game edge, where nobody picked a winner.
  if (s.tbWinnerCorrect == null) return String(s.tiebreakerError);
  return `${s.tbWinnerCorrect ? '✓' : '✗'} ${s.tiebreakerError}`;
}

const TB_TITLE =
  'Tiebreaker order: right winner, then closest to the winner’s score, the loser’s score, ' +
  'the total, then best season record';

interface StandingsTabProps {
  season: SeasonData;
  settings: PoolSettings;
  store: PoolStore;
  /** Index of the currently selected week in season.weeks. */
  weekIndex: number;
  currentPlayerId: string;
}

export function StandingsTab({
  season,
  settings,
  store,
  weekIndex,
  currentPlayerId,
}: StandingsTabProps) {
  const [view, setView] = useState<'week' | 'season'>('week');
  const [weeks, setWeeks] = useState<ScoredWeek[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadScoredWeeks(season, settings, store).then((w) => {
      if (!cancelled) setWeeks(w);
    });
    return () => {
      cancelled = true;
    };
  }, [season, settings, store, weekIndex]);

  if (!weeks) return <p className="results-loading">Loading standings…</p>;

  const weekData = season.weeks[weekIndex];
  const thisWeek =
    weeks.find(
      (w) => w.slate.seasonType === weekData.seasonType && w.slate.week === weekData.week,
    ) ?? null;
  const seasonRows = seasonStandings(weeks);

  return (
    <div className="standings">
      <div className="standings-toggle">
        <button
          type="button"
          className={view === 'week' ? 'active' : ''}
          onClick={() => setView('week')}
        >
          {weekData.label}
        </button>
        <button
          type="button"
          className={view === 'season' ? 'active' : ''}
          onClick={() => setView('season')}
        >
          Season
        </button>
      </div>

      {view === 'week' ? (
        <WeekBoard week={thisWeek} currentPlayerId={currentPlayerId} poolId={store.poolId} />
      ) : (
        <SeasonBoard rows={seasonRows} weeks={weeks} currentPlayerId={currentPlayerId} />
      )}
    </div>
  );
}

function WeekBoard({
  week,
  currentPlayerId,
  poolId,
}: {
  week: ScoredWeek | null;
  currentPlayerId: string;
  poolId: string | null;
}) {
  if (!week || week.scores.length === 0) {
    return (
      <div className="results-empty">
        <div className="results-empty-title">Nothing to rank yet</div>
        <p>Standings show up once the slate is published and picks are in.</p>
      </div>
    );
  }
  const winners = week.scores.filter((s) => s.rank === 1);
  // SBOTW — one league's in-joke (see pool/degenerate.ts), never shown
  // elsewhere. The worst shared rank; the tiebreak hierarchy already sorts the
  // bottom of the board, so anyone still tied down there genuinely co-owns it.
  // Skipped when the worst rank IS 1, i.e. everybody tied for first.
  const worstRank = Math.max(...week.scores.map((s) => s.rank));
  const sbotw =
    poolId === DEGENERATE_NATION_POOL_ID && week.complete && worstRank > 1
      ? week.scores.filter((s) => s.rank === worstRank)
      : [];
  const sbotwIds = new Set(sbotw.map((s) => s.entry.playerId));
  return (
    <div className="board">
      {week.complete && week.scores.length > 0 && (
        <div className="week-winner-banner">
          👑 {winners.map((s) => boardName(s.entry)).join(' & ')}{' '}
          {winners.length > 1 ? 'split' : 'takes'} {week.label}
        </div>
      )}
      {sbotw.length > 0 && (
        <div className="week-winner-banner week-sbotw-banner" title="Shit Bag of the Week">
          💩 {sbotw.map((s) => boardName(s.entry)).join(' & ')}{' '}
          {sbotw.length > 1 ? 'split the' : 'is the'} SBOTW
        </div>
      )}
      <table className="board-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Pts</th>
            <th className="num">W–L–P</th>
            <th className="num" title={TB_TITLE}>
              TB
            </th>
          </tr>
        </thead>
        <tbody>
          {week.scores.map((s: EntryScore) => (
            <tr
              key={s.entry.playerId}
              className={s.entry.playerId === currentPlayerId ? 'me' : ''}
            >
              <td className="num">{s.rank}</td>
              <td>
                {boardName(s.entry)}
                {week.complete && s.rank === 1 && ' 👑'}
                {sbotwIds.has(s.entry.playerId) && ' 💩'}
              </td>
              <td className="num strong">{pointsText(s.points)}</td>
              <td className="num">
                {s.wins}–{s.losses}
                {s.pushes > 0 ? `–${s.pushes}` : ''}
                {s.pending > 0 && <span className="pending-note"> ({s.pending} live)</span>}
              </td>
              <td className="num" title={TB_TITLE}>
                {tbText(s)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeasonBoard({
  rows,
  weeks,
  currentPlayerId,
}: {
  rows: SeasonRow[];
  weeks: ScoredWeek[];
  currentPlayerId: string;
}) {
  if (rows.length === 0) {
    // Week 0 alone leaves this empty on purpose — say so, or it reads as a bug
    // to members who just played a week.
    const onlyWeekZero = weeks.length > 0 && !weeks.some(countsTowardSeason);
    return (
      <div className="results-empty">
        <div className="results-empty-title">Season standings</div>
        <p>
          {onlyWeekZero
            ? 'Week 0 was a warm-up — the season record starts with Week 1.'
            : 'Once weeks are in the books, the overall race shows up here.'}
        </p>
      </div>
    );
  }
  // Only the weeks that actually feed the season record are "played" here —
  // week 0 is a warm-up (see countsTowardSeason).
  const played = weeks.filter(countsTowardSeason).length;
  const hadWeekZero = played < weeks.length;
  return (
    <div className="board">
      <div className="board-sub">
        {played} {played === 1 ? 'week' : 'weeks'} played · total points decide the overall prize,
        weekly wins break ties
        {hadWeekZero && ' · Week 0 was a warm-up — season record starts Week 1'}
      </div>
      <table className="board-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Pts</th>
            <th className="num" title="Weekly wins">
              👑
            </th>
            <th className="num">W–L–P</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.playerId} className={r.playerId === currentPlayerId ? 'me' : ''}>
              <td className="num">{r.rank}</td>
              <td>{boardName(r)}</td>
              <td className="num strong">{pointsText(r.totalPoints)}</td>
              <td className="num">{r.weeklyWins || '—'}</td>
              <td className="num">
                {r.wins}–{r.losses}
                {r.pushes > 0 ? `–${r.pushes}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
