import { useEffect, useMemo, useState } from 'react';
import gamesJson from './data/games.json';
import type { Game, Picks, SeasonData, WeekData } from './types';
import { picksStorageKey } from './types';
import type { WeekResults } from './results';
import { getWeekResults, isGameLocked } from './results';
import { GameCard } from './components/GameCard';
import { ResultsTab } from './components/ResultsTab';
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

function loadPicks(key: string): Picks {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Picks;
  } catch {
    return {};
  }
}

type Tab = 'picks' | 'results';

export default function App() {
  const [tab, setTab] = useState<Tab>('picks');
  const [weekIndex, setWeekIndex] = useState(() => defaultWeekIndex(season.weeks));
  const week = season.weeks[weekIndex];
  const storageKey = picksStorageKey(season.season, week.seasonType, week.week);
  const [picks, setPicks] = useState<Picks>(() => loadPicks(storageKey));
  const [weekResults, setWeekResults] = useState<WeekResults>({});

  useEffect(() => {
    setPicks(loadPicks(storageKey));
  }, [storageKey]);

  useEffect(() => {
    let cancelled = false;
    setWeekResults({});
    getWeekResults(season.season, week).then((r) => {
      if (!cancelled) setWeekResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [week]);

  const handlePick = (gameId: string, teamId: string) => {
    const game = week.games.find((g) => g.id === gameId);
    if (!game || isGameLocked(game, weekResults[gameId])) return;
    setPicks((prev) => {
      const next = { ...prev };
      if (next[gameId] === teamId) delete next[gameId];
      else next[gameId] = teamId;
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  const dayGroups = useMemo(() => {
    const sorted = [...week.games].sort((a, b) => a.date.localeCompare(b.date));
    const groups: { day: string; games: Game[] }[] = [];
    for (const game of sorted) {
      const day = new Date(game.date).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.games.push(game);
      else groups.push({ day, games: [game] });
    }
    return groups;
  }, [week]);

  const pickedCount = week.games.filter((g) => picks[g.id]).length;
  const allPicked = pickedCount === week.games.length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <span className="app-logo">🏈</span>
            <span className="app-title">CFB Pick'em</span>
            <span className="app-season">{season.season} Season</span>
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
              className={tab === 'results' ? 'active' : ''}
              onClick={() => setTab('results')}
            >
              Results
            </button>
          </nav>
        </div>
      </header>

      {tab === 'picks' ? (
        <>
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
            {dayGroups.map((group) => (
              <section key={group.day}>
                <h2 className="day-header">{group.day}</h2>
                <div className="day-games">
                  {group.games.map((game) => (
                    <GameCard
                      key={game.id}
                      game={game}
                      result={weekResults[game.id]}
                      locked={isGameLocked(game, weekResults[game.id])}
                      pickedTeamId={picks[game.id] ?? null}
                      onPick={handlePick}
                    />
                  ))}
                </div>
              </section>
            ))}
          </main>

          <footer className="pick-bar">
            <div className="pick-bar-inner">
              <div className="pick-progress">
                <span className="pick-count">
                  {pickedCount} of {week.games.length} picks made
                </span>
                <div className="pick-meter">
                  <div
                    className="pick-meter-fill"
                    style={{ width: `${(pickedCount / Math.max(week.games.length, 1)) * 100}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                className="submit-btn"
                disabled={pickedCount === 0}
                onClick={() =>
                  alert(
                    allPicked
                      ? `All ${pickedCount} picks locked in for ${week.label}! 🔒`
                      : `${pickedCount} picks saved for ${week.label}. You can still change them until kickoff.`,
                  )
                }
              >
                {allPicked ? 'Lock In Picks' : 'Save Picks'}
              </button>
            </div>
          </footer>
        </>
      ) : (
        <main className="game-list">
          <ResultsTab season={season} />
        </main>
      )}
    </div>
  );
}
