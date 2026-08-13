// Weekly leaderboard (winner crowned when every slate game is final) and
// season-long standings for the overall prize pool.

import { useEffect, useState } from 'react';
import type { SeasonData } from '../types';
import { getWeekResults } from '../results';
import type { PoolSettings } from '../pool/types';
import type { PoolStore } from '../pool/store';
import type { EntryScore, ScoredWeek, SeasonRow } from '../pool/scoring';
import { isWeekComplete, scoreWeek, seasonStandings } from '../pool/scoring';

function pointsText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

async function loadScoredWeeks(
  season: SeasonData,
  settings: PoolSettings,
  store: PoolStore,
): Promise<ScoredWeek[]> {
  const out: ScoredWeek[] = [];
  for (const weekData of season.weeks) {
    const slate = await store.getSlate(season.season, weekData.seasonType, weekData.week);
    if (!slate || !slate.published || slate.games.length === 0) continue;
    const entries = await store.getEntries(season.season, weekData.seasonType, weekData.week);
    if (entries.length === 0) continue;
    const results = await getWeekResults(season.season, weekData);
    out.push({
      slate,
      label: weekData.label,
      scores: scoreWeek(slate, entries, results, settings),
      complete: isWeekComplete(slate, results),
    });
  }
  return out;
}

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
        <WeekBoard week={thisWeek} currentPlayerId={currentPlayerId} />
      ) : (
        <SeasonBoard rows={seasonRows} weeks={weeks} currentPlayerId={currentPlayerId} />
      )}
    </div>
  );
}

function WeekBoard({ week, currentPlayerId }: { week: ScoredWeek | null; currentPlayerId: string }) {
  if (!week || week.scores.length === 0) {
    return (
      <div className="results-empty">
        <div className="results-empty-title">Nothing to rank yet</div>
        <p>Standings show up once the slate is published and picks are in.</p>
      </div>
    );
  }
  return (
    <div className="board">
      {week.complete && week.scores.length > 0 && (
        <div className="week-winner-banner">
          👑 {week.scores.filter((s) => s.rank === 1).map((s) => s.entry.playerName).join(' & ')}{' '}
          {week.scores.filter((s) => s.rank === 1).length > 1 ? 'split' : 'takes'} {week.label}
        </div>
      )}
      <table className="board-table">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="num">Pts</th>
            <th className="num">W–L–P</th>
            <th className="num" title="Tiebreaker distance (total points)">
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
                {s.entry.playerName}
                {week.complete && s.rank === 1 && ' 👑'}
              </td>
              <td className="num strong">{pointsText(s.points)}</td>
              <td className="num">
                {s.wins}–{s.losses}
                {s.pushes > 0 ? `–${s.pushes}` : ''}
                {s.pending > 0 && <span className="pending-note"> ({s.pending} live)</span>}
              </td>
              <td className="num">{s.tiebreakerError ?? '—'}</td>
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
    return (
      <div className="results-empty">
        <div className="results-empty-title">Season standings</div>
        <p>Once weeks are in the books, the overall race shows up here.</p>
      </div>
    );
  }
  return (
    <div className="board">
      <div className="board-sub">
        {weeks.length} {weeks.length === 1 ? 'week' : 'weeks'} played · total points decide the
        overall prize, weekly wins break ties
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
              <td>{r.playerName}</td>
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
