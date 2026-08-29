// Pick-sheet card: pick a side against the locked spread. Shows live cover
// state while games run and win/loss/push once final. coverOdds is the slot
// for live market odds (Kalshi) when they're available for a game.

import type { Game, Team } from '../types';
import type { GameResult } from '../results';
import type { CoverOdds, PickSide, PickType, SlateGame } from '../pool/types';
import { formatSpread } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';

export type { CoverOdds };

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Coarse weather emoji from ESPN's conditionId (sourced from AccuWeather's
 * public condition-code index, https://developer.accuweather.com/weather-icons —
 * ESPN passes these through as strings; results.ts already coerces to number).
 * Unknown/missing ids return null — callers fall back to a text-only chip.
 */
export function weatherEmoji(conditionId: number | null): string | null {
  if (conditionId == null) return null;
  const id = conditionId;
  if (id >= 1 && id <= 2) return '☀️';
  if (id >= 3 && id <= 6) return '⛅';
  if (id === 11) return '🌫️';
  if (id >= 7 && id <= 11) return '☁️';
  if (id >= 12 && id <= 14) return '🌧️';
  if (id >= 15 && id <= 17) return '⛈️';
  if (id === 18) return '🌧️';
  if (id >= 19 && id <= 23) return '🌨️';
  if (id >= 24 && id <= 26) return '🧊';
  if (id === 29) return '🌨️';
  if (id === 30) return '🥵';
  if (id === 31) return '🥶';
  if (id === 32) return '💨';
  if (id >= 33 && id <= 34) return '🌙';
  if (id >= 35 && id <= 38) return '☁️';
  if (id >= 39 && id <= 40) return '🌧️';
  if (id >= 41 && id <= 42) return '⛈️';
  if (id >= 43 && id <= 44) return '🌨️';
  return null;
}

interface WeatherChipContent {
  text: string;
  title?: string;
}

/**
 * Pregame-only weather chip content. Indoor wins over any weather object;
 * missing temp falls back to the displayValue text alone; no usable data
 * (or the game has kicked off) renders nothing.
 */
function buildWeatherChip(result?: GameResult | null): WeatherChipContent | null {
  if (!result || result.state !== 'pre') return null;
  if (result.indoor) return { text: '🏟️ Dome' };
  const weather = result.weather;
  if (!weather) return null;
  if (weather.temp != null) {
    const emoji = weatherEmoji(weather.conditionId);
    const text = emoji ? `${emoji} ${weather.temp}°` : `${weather.temp}°`;
    return weather.text ? { text, title: weather.text } : { text };
  }
  return weather.text ? { text: weather.text } : null;
}

interface AtsTeamRowProps {
  team: Team;
  spread: number;
  showSpread: boolean;
  coveringLabel: string;
  oddsTitle: string;
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
  showSpread,
  coveringLabel,
  oddsTitle,
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
        {showSpread && <span className="team-spread">{formatSpread(spread)}</span>}
      </span>
      {odds != null && (
        <span className="cover-odds" title={oddsTitle}>
          {Math.round(odds * 100)}%
        </span>
      )}
      {showScore && score != null && (
        <span className={`score${covering ? ' winner' : ''}`}>{score}</span>
      )}
      {showScore && covering && !final && <span className="covering-tag">{coveringLabel}</span>}
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
  pickType?: PickType;
  result?: GameResult | null;
  locked: boolean;
  /** Force read-only regardless of `locked` — used by the Scoreboard tab,
   * where `locked` only drives the "Locked" badge, not interactivity. */
  readOnly?: boolean;
  pickedSide: PickSide | null;
  coverOdds?: CoverOdds | null;
  onPick?: (gameId: string, side: PickSide) => void;
}

export function AtsGameCard({
  game,
  slateGame,
  pickType = 'ats',
  result,
  locked,
  readOnly = false,
  pickedSide,
  coverOdds,
  onPick,
}: AtsGameCardProps) {
  const { home, away } = game;
  if (!home || !away) return null;
  const interactionLocked = locked || readOnly;
  const started = !!result && result.state !== 'pre';
  const live = !!result && result.state === 'in';
  const final = !!result?.completed;
  const margin = result ? coverMargin(slateGame.homeSpread, result) : null;
  const homeCovering = started && margin != null ? margin > 0 : null;
  const awayCovering = started && margin != null ? margin < 0 : null;
  const push = final && margin === 0;
  const grade = pickedSide ? gradeAts(pickedSide, slateGame, result) : null;
  const ats = pickType === 'ats';
  const coveringLabel = ats ? 'covering' : 'leading';
  const oddsTitle = ats ? 'Market odds to cover' : 'Market odds to win';
  const weatherChip = buildWeatherChip(result);

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
        {weatherChip && (
          <span className="weather-chip" title={weatherChip.title}>
            {weatherChip.text}
          </span>
        )}
      </div>
      <AtsTeamRow
        team={away}
        spread={-slateGame.homeSpread}
        showSpread={ats}
        coveringLabel={coveringLabel}
        oddsTitle={oddsTitle}
        picked={pickedSide === 'away'}
        locked={interactionLocked}
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
        showSpread={ats}
        coveringLabel={coveringLabel}
        oddsTitle={oddsTitle}
        picked={pickedSide === 'home'}
        locked={interactionLocked}
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
