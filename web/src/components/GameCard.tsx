// Mirrors mobile/components/GameCard.tsx (see CLAUDE.md parity rule)

import type { Game, Team } from '../types';
import type { GameResult, PickGrade } from '../results';
import { gradePick } from '../results';

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface TeamRowProps {
  team: Team;
  picked: boolean;
  locked: boolean;
  score: number | null;
  showScore: boolean;
  isWinner: boolean;
  grade: PickGrade | null; // set only when this row is the picked team and game completed
  onSelect: () => void;
}

function TeamRow({ team, picked, locked, score, showScore, isWinner, grade, onSelect }: TeamRowProps) {
  const selectable = !locked && !!team.id && team.school !== 'TBD';
  const lost = grade === 'loss';
  const rowClass = [
    'team-row',
    picked && !lost ? 'picked' : '',
    picked && lost ? 'picked-loss' : '',
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
        {team.mascot && <span className="team-mascot">{team.mascot}</span>}
      </span>
      {showScore && score != null && (
        <span className={`score${isWinner ? ' winner' : ''}`}>{score}</span>
      )}
      <span
        className={`pick-indicator${picked ? (lost ? ' loss' : ' on') : ''}`}
        aria-hidden="true"
      >
        {picked ? (lost ? '✗' : '✓') : ''}
      </span>
    </button>
  );
}

interface GameCardProps {
  game: Game;
  result?: GameResult | null;
  locked: boolean;
  pickedTeamId: string | null;
  onPick: (gameId: string, teamId: string) => void;
}

export function GameCard({ game, result, locked, pickedTeamId, onPick }: GameCardProps) {
  const { home, away } = game;
  if (!home || !away) return null;
  const venueBits = [game.venue.name, game.venue.city, game.venue.state].filter(Boolean);
  const started = !!result && result.state !== 'pre';
  const live = !!result && result.state === 'in';
  const grade = pickedTeamId && result?.completed ? gradePick(pickedTeamId, result) : null;
  return (
    <div className="game-card">
      <div className="game-meta">
        <span className={`game-time${live ? ' live' : ''}`}>
          {started ? result.detail ?? 'In progress' : formatKickoff(game.date)}
        </span>
        {game.conferenceGame && !started && <span className="conf-badge">Conf</span>}
        {locked && !started && <span className="lock-badge">Locked</span>}
        {!started && <span className="game-tv">{game.broadcast ?? 'TV TBD'}</span>}
      </div>
      <TeamRow
        team={away}
        picked={pickedTeamId === away.id}
        locked={locked}
        score={result?.awayScore ?? null}
        showScore={started}
        isWinner={!result?.completed || result.winnerTeamId === away.id}
        grade={pickedTeamId === away.id ? grade : null}
        onSelect={() => away.id && onPick(game.id, away.id)}
      />
      <div className="team-separator">
        <span>{game.neutralSite ? 'vs' : 'at'}</span>
      </div>
      <TeamRow
        team={home}
        picked={pickedTeamId === home.id}
        locked={locked}
        score={result?.homeScore ?? null}
        showScore={started}
        isWinner={!result?.completed || result.winnerTeamId === home.id}
        grade={pickedTeamId === home.id ? grade : null}
        onSelect={() => home.id && onPick(game.id, home.id)}
      />
      {venueBits.length > 0 && <div className="game-venue">{venueBits.join(' · ')}</div>}
    </div>
  );
}
