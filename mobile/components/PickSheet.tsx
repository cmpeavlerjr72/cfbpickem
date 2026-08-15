// The player's weekly sheet — mirrors web/src/components/PickSheet.tsx (see
// CLAUDE.md parity rule). Picks save as you go; the WHOLE sheet locks at the
// week's first kickoff. `overriding` = commissioner editing another member's
// sheet, which ignores the lock.

import { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Game, WeekData } from '../types';
import type { WeekResults } from '../results';
import { isGameLocked } from '../results';
import type { PickSide, PoolEntry, WeekSlate } from '../pool/types';
import { spreadLockTime } from '../pool/spreads';
import type { CoverOdds } from './AtsGameCard';
import { AtsGameCard } from './AtsGameCard';
import { colors } from '../theme';

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

  if (!slate || !slate.published || slate.games.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No slate yet for {week.label}</Text>
        <Text style={styles.emptyText}>
          The commissioner hasn’t posted this week’s games. Slates go up with spreads locked as
          of Monday — check back soon.
        </Text>
      </View>
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
    <View>
      {picksLocked && !overriding ? (
        <View style={styles.lockedNote}>
          <Text style={styles.lockedNoteText}>
            Picks are locked for {week.label} — the first game has kicked off.
          </Text>
        </View>
      ) : !picksLocked && deadlineLabel ? (
        <View style={styles.deadlineNote}>
          <Text style={styles.deadlineNoteText}>
            All picks (and the tiebreaker) lock at the week’s first kickoff: {deadlineLabel}.
          </Text>
        </View>
      ) : null}
      {linesFloating && (
        <View style={styles.lockedNote}>
          <Text style={styles.lockedNoteText}>
            Spreads shown are live market numbers — they lock for good on {lockLabel}.
          </Text>
        </View>
      )}
      {dayGroups.map((group) => (
        <View key={group.day}>
          <Text style={styles.dayHeader}>{group.day}</Text>
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
        </View>
      ))}

      {tbEntry && (
        <View>
          <Text style={styles.dayHeader}>Tiebreaker · College GameDay game</Text>
          <View style={styles.tbCard}>
            <Text style={styles.tbPrompt}>
              Predict the final score of{' '}
              <Text style={styles.tbStrong}>
                {tbEntry.game.away?.school} {tbEntry.game.neutralSite ? 'vs' : 'at'}{' '}
                {tbEntry.game.home?.school}
              </Text>
              . Closest total score wins ties.
            </Text>
            <View style={styles.tbInputs}>
              <View style={styles.tbField}>
                <Text style={styles.tbLabel}>
                  {tbEntry.game.away?.abbrev ?? tbEntry.game.away?.school}
                </Text>
                <TextInput
                  style={[styles.tbInput, tbLocked && styles.tbInputDisabled]}
                  keyboardType="number-pad"
                  editable={!tbLocked}
                  value={entry.tiebreaker?.away != null ? String(entry.tiebreaker.away) : ''}
                  onChangeText={(t) =>
                    onTiebreaker(
                      entry.tiebreaker?.home ?? null,
                      t === '' ? null : Number(t.replace(/[^0-9]/g, '')) || 0,
                    )
                  }
                />
              </View>
              <Text style={styles.tbDash}>–</Text>
              <View style={styles.tbField}>
                <Text style={styles.tbLabel}>
                  {tbEntry.game.home?.abbrev ?? tbEntry.game.home?.school}
                </Text>
                <TextInput
                  style={[styles.tbInput, tbLocked && styles.tbInputDisabled]}
                  keyboardType="number-pad"
                  editable={!tbLocked}
                  value={entry.tiebreaker?.home != null ? String(entry.tiebreaker.home) : ''}
                  onChangeText={(t) =>
                    onTiebreaker(
                      t === '' ? null : Number(t.replace(/[^0-9]/g, '')) || 0,
                      entry.tiebreaker?.away ?? null,
                    )
                  }
                />
              </View>
            </View>
            {tbLocked && (
              <Text style={styles.tbLockedNote}>Tiebreaker locked with the rest of the slate.</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    margin: 16,
    padding: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textDim,
    textAlign: 'center',
  },
  lockedNote: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 10,
    padding: 10,
  },
  lockedNoteText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.amber,
  },
  deadlineNote: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
  },
  deadlineNoteText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  dayHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textDim,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  tbCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
  },
  tbPrompt: {
    fontSize: 14,
    color: colors.text,
  },
  tbStrong: {
    fontWeight: '800',
  },
  tbInputs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  tbField: {
    alignItems: 'center',
    gap: 4,
  },
  tbLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  tbInput: {
    width: 72,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
  },
  tbInputDisabled: {
    backgroundColor: colors.bg,
    color: colors.textDim,
  },
  tbDash: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textDim,
    paddingBottom: 10,
  },
  tbLockedNote: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textDim,
  },
});
