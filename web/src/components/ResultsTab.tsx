// Season record + week-by-week results, graded from live scores.
// Mirrors mobile/components/ResultsTab.tsx (see CLAUDE.md parity rule)

import { useEffect, useState } from 'react';
import type { SeasonData } from '../types';
import type { SeasonSummary, WeekSummary } from '../results';
import { buildSeasonSummary } from '../results';

function recordText(w: WeekSummary): string {
  if (w.picks === 0) return '—';
  if (w.wins + w.losses > 0) {
    return `${w.wins}–${w.losses}${w.pending ? ` · ${w.pending} left` : ''}`;
  }
  return w.started ? 'In progress' : 'Pending';
}

function firstKickoff(season: SeasonData): string {
  const first = Math.min(...season.weeks[0].games.map((g) => new Date(g.date).getTime()));
  return new Date(first).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function ResultsTab({ season }: { season: SeasonData }) {
  const [summary, setSummary] = useState<SeasonSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    buildSeasonSummary(season).then((s) => {
      if (!cancelled) setSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [season]);

  if (!summary) {
    return <p className="results-loading">Loading results…</p>;
  }

  const rows = summary.weeks.filter((w) => w.picks > 0 || w.started);
  const graded = summary.wins + summary.losses;

  return (
    <div className="results">
      <div className="record-card">
        <div className="record-big">
          {summary.wins}–{summary.losses}
        </div>
        <div className="record-label">Season record</div>
        <div className="record-sub">
          {graded > 0
            ? `${Math.round((summary.wins / graded) * 100)}% correct · ${summary.totalPicks} picks made`
            : `${summary.totalPicks} picks made · nothing graded yet`}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="results-empty">
          <div className="results-empty-title">No results yet</div>
          <p>
            Make your picks and they'll be graded automatically as games go final. The season
            kicks off {firstKickoff(season)}.
          </p>
        </div>
      ) : (
        <div className="week-rows">
          {rows.map((w) => (
            <div key={`${w.seasonType}-${w.week}`} className="week-row">
              <span className="week-row-label">{w.label}</span>
              <span className="week-row-picks">
                {w.picks} {w.picks === 1 ? 'pick' : 'picks'}
              </span>
              <span className="week-row-record">{recordText(w)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
