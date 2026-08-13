// Pick-sheet card: pick a side against the locked spread. Shows live cover
// state while games run and win/loss/push once final. coverOdds is the slot
// for live market odds (Kalshi) when they're available for a game.

import type { Game, Team } from '../types';
import type { GameResult } from '../results';
import type { CoverOdds, PickSide, SlateGame } from '../pool/types';
import { formatSpread } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';

export type { CoverOdds };

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface AtsTeamRowProps {
  team: Team;
  spread: number;
  picked: boolean;
  locked: boolean;
  score: number | null;
  showScore: boolean;
  covering: boolean | null; // live/final: is this side covering right now?
  final: boolean;
  push: boolean;
  odds: number | null;
  onSelect: () => void;
}

function AtsTeamRow({
  team,
  spread,
  picked,
  locked,
  score,
  showScore,
  covering,
  final,
  push,
  odds,
  onSelect,
}: AtsTeamRowProps) {
  const selectable = !locked && !!team.id && team.school !== 'TBD';
  const lost = picked && final && !push && covering === false;
  const rowClass = [
    'team-row',
    picked && !lost && !push ? 'picked' : '',
    picked && lost ? 'picked-loss' : '',
    picked && push ? 'picked-push' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={rowClass} onClick={onSelect} disabled={!selectable}>
      {team.logo ? (
        <img className="team-logo" src={team.logo} alt="" loading="lazy" />
      ) : (
        <span className="team-logo team-logo-placeholder">{team.school.charAt(0)}</span>
      )}
      <span className="team-name">
        {team.rank != null && <span className="team-rank">#{team.rank}</span>}
        <span className="team-school">{team.school}</span>
        <span className="team-spread">{formatSpread(spread)}</span>
      </span>
      {odds != null && (
        <span className="cover-odds" title="Market odds to cover">
          {Math.round(odds * 100)}%
        </span>
      )}
      {showScore && score != null && (
        <span className={`score${covering ? ' winner' : ''}`}>{score}</span>
      )}
      {showScore && covering && !final && <span className="covering-tag">covering</span>}
      <span
        className={`pick-indicator${picked ? (lost ? ' loss' : push && final ? ' push' : ' on') : ''}`}
        aria-hidden="true"
      >
        {picked ? (lost ? '✗' : final && push ? '=' : '✓') : ''}
      </span>
    </button>
  );
}

interface AtsGameCardProps {
  game: Game;
  slateGame: SlateGame;
  result?: GameResult | null;
  locked: boolean;
  pickedSide: PickSide | null;
  coverOdds?: CoverOdds | null;
  onPick?: (gameId: string, side: PickSide) => void;
}

export function AtsGameCard({
  game,
  slateGame,
  result,
  locked,
  pickedSide,
  coverOdds,
  onPick,
}: AtsGameCardProps) {
  const { home, away } = game;
  if (!home || !away) return null;
  const started = !!result && result.state !== 'pre';
  const live = !!result && result.state === 'in';
  const final = !!result?.completed;
  const margin = result ? coverMargin(slateGame.homeSpread, result) : null;
  const homeCovering = started && margin != null ? margin > 0 : null;
  const awayCovering = started && margin != null ? margin < 0 : null;
  const push = final && margin === 0;
  const grade = pickedSide ? gradeAts(pickedSide, slateGame, result) : null;

  return (
    <div className={`game-card${slateGame.isTiebreaker ? ' tiebreaker-card' : ''}`}>
      <div className="game-meta">
        <span className={`game-time${live ? ' live' : ''}`}>
          {started ? result!.detail ?? 'In progress' : formatKickoff(game.date)}
        </span>
        {slateGame.isTiebreaker && <span className="tb-badge">GameDay TB</span>}
        {locked && !started && <span className="lock-badge">Locked</span>}
        {final && grade === 'push' && <span className="push-badge">Push</span>}
        {!started && <span className="game-tv">{game.broadcast ?? 'TV TBD'}</span>}
      </div>
      <AtsTeamRow
        team={away}
        spread={-slateGame.homeSpread}
        picked={pickedSide === 'away'}
        locked={locked}
        score={result?.awayScore ?? null}
        showScore={started}
        covering={awayCovering}
        final={final}
        push={push}
        odds={coverOdds?.away ?? null}
        onSelect={() => onPick?.(game.id, 'away')}
      />
      <div className="team-separator">
        <span>{game.neutralSite ? 'vs' : 'at'}</span>
      </div>
      <AtsTeamRow
        team={home}
        spread={slateGame.homeSpread}
        picked={pickedSide === 'home'}
        locked={locked}
        score={result?.homeScore ?? null}
        showScore={started}
        covering={homeCovering}
        final={final}
        push={push}
        odds={coverOdds?.home ?? null}
        onSelect={() => onPick?.(game.id, 'home')}
      />
    </div>
  );
}
