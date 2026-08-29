// The player's weekly sheet: ATS pick on each slate game plus the GameDay
// tiebreaker score guess. Picks save as you go; the WHOLE sheet locks at the
// week's first kickoff (no late-addition picks). `overriding` = commissioner
// editing another member's sheet, which ignores the lock.

import { useEffect, useMemo, useState } from 'react';
import type { Game, WeekData } from '../types';
import type { WeekResults } from '../results';
import { isGameLocked } from '../results';
import type { PickSide, PoolEntry, WeekSlate } from '../pool/types';
import { spreadLockTime } from '../pool/spreads';
import type { CoverOdds } from './AtsGameCard';
import { AtsGameCard } from './AtsGameCard';

interface PickSheetProps {
  week: WeekData;
  slate: WeekSlate | null;
  entry: PoolEntry;
  results: WeekResults;
  coverOdds?: Record<string, CoverOdds>;
  picksLockAt: Date | null;
  picksLocked: boolean;
  overriding: boolean;
  onPick: (gameId: string, side: PickSide) => void;
  onTiebreaker: (home: number | null, away: number | null) => void;
}

export function PickSheet({
  week,
  slate,
  entry,
  results,
  coverOdds,
  picksLockAt,
  picksLocked,
  overriding,
  onPick,
  onTiebreaker,
}: PickSheetProps) {
  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  // Tiebreaker score inputs use local string state so the field can go
  // empty while typing. Deriving `value` straight from a `number | null`
  // (the old code) breaks on the very first digit: onTiebreaker fills the
  // untouched side with 0 (see App.tsx handleTiebreaker), which flashes a
  // "0" into that input and produces leading-zero artifacts ("07") the
  // next time someone types into it. Re-sync only when the tiebreaker game
  // or the player being edited changes (data load, week switch,
  // commissioner switching whose sheet they're editing) — never on every
  // keystroke, or the same 0 fill-in would clobber what's being typed.
  const tbGameId = slate?.games.find((sg) => sg.isTiebreaker)?.gameId ?? null;
  const [awayText, setAwayText] = useState(() =>
    entry.tiebreaker?.away != null ? String(entry.tiebreaker.away) : '',
  );
  const [homeText, setHomeText] = useState(() =>
    entry.tiebreaker?.home != null ? String(entry.tiebreaker.home) : '',
  );
  useEffect(() => {
    setAwayText(entry.tiebreaker?.away != null ? String(entry.tiebreaker.away) : '');
    setHomeText(entry.tiebreaker?.home != null ? String(entry.tiebreaker.home) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tbGameId, entry.playerId]);

  const commitAway = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setAwayText(digits);
    onTiebreaker(homeText === '' ? null : Number(homeText), digits === '' ? null : Number(digits));
  };
  const commitHome = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    setHomeText(digits);
    onTiebreaker(digits === '' ? null : Number(digits), awayText === '' ? null : Number(awayText));
  };

  if (!slate || !slate.published || slate.games.length === 0) {
    return (
      <div className="results-empty">
        <div className="results-empty-title">No slate yet for {week.label}</div>
        <p>
          The commissioner hasn’t posted this week’s games. Slates go up with spreads locked as
          of Monday — check back soon.
        </p>
      </div>
    );
  }

  const slateGames = slate.games
    .map((sg) => ({ sg, game: gamesById.get(sg.gameId) }))
    .filter((x): x is { sg: (typeof slate.games)[number]; game: Game } => !!x.game)
    .sort((a, b) => a.game.date.localeCompare(b.game.date));

  const tbEntry = slateGames.find((x) => x.sg.isTiebreaker);

  const dayGroups: { day: string; items: typeof slateGames }[] = [];
  for (const item of slateGames) {
    const day = new Date(item.game.date).toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    const last = dayGroups[dayGroups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else dayGroups.push({ day, items: [item] });
  }

  const tbLocked = overriding
    ? false
    : picksLocked || (tbEntry ? isGameLocked(tbEntry.game, results[tbEntry.game.id]) : true);

  const linesFloating =
    slate.pickType !== 'su' && !slate.spreadsLockedAt && slateGames.length > 0
      ? Date.now() < spreadLockTime(slateGames[0].game.date).getTime()
      : false;
  const lockLabel = linesFloating
    ? spreadLockTime(slateGames[0].game.date).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  const deadlineLabel = picksLockAt?.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <>
      {picksLocked && !overriding ? (
        <div className="lines-note">
          Picks are locked for {week.label} — the first game has kicked off.
        </div>
      ) : !picksLocked && deadlineLabel ? (
        <div className="deadline-note">
          All picks (and the tiebreaker) lock at the week’s first kickoff: {deadlineLabel}.
        </div>
      ) : null}
      {linesFloating && (
        <div className="lines-note">
          Spreads shown are live market numbers — they lock for good on {lockLabel}.
        </div>
      )}
      {dayGroups.map((group) => (
        <section key={group.day}>
          <h2 className="day-header">{group.day}</h2>
          <div className="day-games">
            {group.items.map(({ sg, game }) => (
              <AtsGameCard
                key={game.id}
                game={game}
                slateGame={sg}
                pickType={slate.pickType ?? 'ats'}
                result={results[game.id]}
                locked={overriding ? false : picksLocked || isGameLocked(game, results[game.id])}
                pickedSide={entry.picks[game.id] ?? null}
                coverOdds={coverOdds?.[game.id] ?? null}
                onPick={onPick}
              />
            ))}
          </div>
        </section>
      ))}

      {tbEntry && (
        <section>
          <h2 className="day-header">Tiebreaker · College GameDay game</h2>
          <div className="tb-card">
            <p className="tb-prompt">
              Predict the final score of{' '}
              <strong>
                {tbEntry.game.away?.school} {tbEntry.game.neutralSite ? 'vs' : 'at'}{' '}
                {tbEntry.game.home?.school}
              </strong>
              . Closest total score wins ties.
            </p>
            <div className="tb-inputs">
              <label>
                <span>{tbEntry.game.away?.abbrev ?? tbEntry.game.away?.school}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={tbLocked}
                  value={awayText}
                  onChange={(e) => commitAway(e.target.value)}
                />
              </label>
              <span className="tb-dash">–</span>
              <label>
                <span>{tbEntry.game.home?.abbrev ?? tbEntry.game.home?.school}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={tbLocked}
                  value={homeText}
                  onChange={(e) => commitHome(e.target.value)}
                />
              </label>
            </div>
            {tbLocked && <p className="tb-locked-note">Tiebreaker locked with the rest of the slate.</p>}
          </div>
        </section>
      )}
    </>
  );
}
