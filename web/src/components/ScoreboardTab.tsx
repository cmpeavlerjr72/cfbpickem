// Live scoreboard for the week's slate: game state (clock, possession,
// last play) plus where every player stands, ordered live → upcoming → final.
// Picks stay hidden until the slate locks at the week's first kickoff (the
// server hides them too); after that everyone's whole sheet is visible.

import { useMemo, useState } from 'react';
import type { Game, WeekData } from '../types';
import type { GameResult, WeekResults } from '../results';
import type { CoverOdds, PoolEntry, SlateGame, WeekSlate } from '../pool/types';
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
  picksLocked: boolean;
  currentPlayerId: string;
  isCommissioner: boolean;
}

export function ScoreboardTab({
  week,
  slate,
  entries,
  results,
  coverOdds,
  picksLocked,
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
      {items.map(({ sg, game }) => {
        const result = results[game.id];
        const live = result?.state === 'in';
        return (
          <div key={game.id} className="scoreboard-item">
            <AtsGameCard
              game={game}
              slateGame={sg}
              pickType={slate.pickType ?? 'ats'}
              result={result}
              locked={picksLocked}
              readOnly
              pickedSide={myEntry?.picks[game.id] ?? null}
              coverOdds={coverOdds[game.id] ?? null}
            />
            {live && (
              <>
                <LiveSituation game={game} result={result!} />
                <button
                  type="button"
                  className="gamecast-toggle-btn"
                  onClick={() =>
                    setOpenGamecastId((cur) => (cur === game.id ? null : game.id))
                  }
                >
                  {openGamecastId === game.id ? 'Hide gamecast ▲' : 'Gamecast ▼'}
                </button>
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
            <PickChips
              game={game}
              slateGame={sg}
              result={result}
              entries={entries}
              picksLocked={picksLocked}
              isCommissioner={isCommissioner}
              currentPlayerId={currentPlayerId}
            />
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

interface PickChipsProps {
  game: Game;
  slateGame: SlateGame;
  result?: GameResult;
  entries: PoolEntry[];
  picksLocked: boolean;
  isCommissioner: boolean;
  currentPlayerId: string;
}

function PickChips({
  game,
  slateGame,
  result,
  entries,
  picksLocked,
  isCommissioner,
  currentPlayerId,
}: PickChipsProps) {
  const withPicks = entries.filter((e) => e.picks[slateGame.gameId]);
  if (withPicks.length === 0) return null;

  const revealed = picksLocked || isCommissioner;
  if (!revealed) {
    return (
      <div className="pick-chips">
        <span className="pick-chips-note">
          {withPicks.length} {withPicks.length === 1 ? 'pick' : 'picks'} in — revealed when the
          slate locks at the first kickoff
        </span>
      </div>
    );
  }

  const commissionerPreview = isCommissioner && !picksLocked;
  const margin = result ? coverMargin(slateGame.homeSpread, result) : null;
  const started = !!result && result.state !== 'pre';
  return (
    <div className="pick-chips">
      {commissionerPreview && (
        <span className="pick-chips-note">
          {withPicks.length} of {entries.length} {withPicks.length === 1 ? 'pick' : 'picks'} in ·
          visible to you as commissioner
        </span>
      )}
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
