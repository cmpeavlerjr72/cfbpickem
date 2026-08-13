// Live scoreboard for the week's slate: game state (clock, possession,
// last play) plus where every player stands, ordered live → upcoming → final.
// Picks stay hidden until a game locks so nobody can copy sheets.

import { useMemo } from 'react';
import type { Game, WeekData } from '../types';
import type { GameResult, WeekResults } from '../results';
import { isGameLocked } from '../results';
import type { CoverOdds, PoolEntry, SlateGame, WeekSlate } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';
import { AtsGameCard } from './AtsGameCard';

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
}

export function ScoreboardTab({
  week,
  slate,
  entries,
  results,
  coverOdds,
  currentPlayerId,
}: ScoreboardTabProps) {
  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

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
      {items.map(({ sg, game }) => {
        const result = results[game.id];
        const locked = isGameLocked(game, result);
        const live = result?.state === 'in';
        return (
          <div key={game.id} className="scoreboard-item">
            <AtsGameCard
              game={game}
              slateGame={sg}
              pickType={slate.pickType ?? 'ats'}
              result={result}
              locked
              pickedSide={myEntry?.picks[game.id] ?? null}
              coverOdds={coverOdds[game.id] ?? null}
            />
            {live && <LiveSituation game={game} result={result!} />}
            <PickChips
              game={game}
              slateGame={sg}
              result={result}
              entries={entries}
              revealed={locked}
              currentPlayerId={currentPlayerId}
            />
          </div>
        );
      })}
    </div>
  );
}

function LiveSituation({ game, result }: { game: Game; result: GameResult }) {
  const possessionTeam =
    result.possessionTeamId === game.home?.id
      ? game.home
      : result.possessionTeamId === game.away?.id
        ? game.away
        : null;
  const bits: string[] = [];
  if (possessionTeam) bits.push(`🏈 ${possessionTeam.abbrev ?? possessionTeam.school}`);
  if (result.downDistance) bits.push(result.downDistance);
  if (bits.length === 0 && !result.lastPlay) return null;
  return (
    <div className={`live-situation${result.isRedZone ? ' redzone' : ''}`}>
      {bits.length > 0 && <span className="live-situation-line">{bits.join(' · ')}</span>}
      {result.lastPlay && <span className="live-lastplay">{result.lastPlay}</span>}
    </div>
  );
}

interface PickChipsProps {
  game: Game;
  slateGame: SlateGame;
  result?: GameResult;
  entries: PoolEntry[];
  revealed: boolean;
  currentPlayerId: string;
}

function PickChips({ game, slateGame, result, entries, revealed, currentPlayerId }: PickChipsProps) {
  const withPicks = entries.filter((e) => e.picks[slateGame.gameId]);
  if (withPicks.length === 0) return null;

  if (!revealed) {
    return (
      <div className="pick-chips">
        <span className="pick-chips-note">
          {withPicks.length} {withPicks.length === 1 ? 'pick' : 'picks'} in — revealed at kickoff
        </span>
      </div>
    );
  }

  const margin = result ? coverMargin(slateGame.homeSpread, result) : null;
  const started = !!result && result.state !== 'pre';
  return (
    <div className="pick-chips">
      {withPicks.map((entry) => {
        const side = entry.picks[slateGame.gameId];
        const team = side === 'home' ? game.home : game.away;
        const grade = gradeAts(side, slateGame, result);
        let tone = 'neutral';
        if (grade === 'win') tone = 'win';
        else if (grade === 'loss') tone = 'loss';
        else if (grade === 'push') tone = 'push';
        else if (started && margin != null) {
          tone = (side === 'home') === margin > 0 ? 'ahead' : margin === 0 ? 'push' : 'behind';
        }
        return (
          <span
            key={entry.playerId}
            className={`pick-chip ${tone}${entry.playerId === currentPlayerId ? ' me' : ''}`}
            title={`${entry.playerName}: ${team?.school ?? side}`}
          >
            {entry.playerName} · {team?.abbrev ?? team?.school ?? side}
          </span>
        );
      })}
    </div>
  );
}
