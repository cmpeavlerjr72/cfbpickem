// Live scoreboard — mirrors web/src/components/ScoreboardTab.tsx (see
// CLAUDE.md parity rule): game state plus where every player stands, ordered
// live → upcoming → final. Picks stay hidden until the slate locks at the
// week's first kickoff (the server hides them too).

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Game, WeekData } from '../types';
import type { GameResult, WeekResults } from '../results';
import type { CoverOdds, PoolEntry, SlateGame, WeekSlate } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';
import { AtsGameCard } from './AtsGameCard';
import { colors } from '../theme';

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

  if (!slate || !slate.published || slate.games.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No slate for {week.label} yet</Text>
        <Text style={styles.emptyText}>
          The live scoreboard lights up once the commissioner posts the games.
        </Text>
      </View>
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
    <View style={styles.list}>
      {items.map(({ sg, game }) => {
        const result = results[game.id];
        const live = result?.state === 'in';
        return (
          <View key={game.id} style={styles.item}>
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
            {live && <LiveSituation game={game} result={result!} />}
            <PickChips
              game={game}
              slateGame={sg}
              result={result}
              entries={entries}
              picksLocked={picksLocked}
              isCommissioner={isCommissioner}
              currentPlayerId={currentPlayerId}
            />
          </View>
        );
      })}
    </View>
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
    <View style={[styles.liveSituation, result.isRedZone && styles.redzone]}>
      {bits.length > 0 && <Text style={styles.liveLine}>{bits.join(' · ')}</Text>}
      {result.lastPlay && (
        <Text style={styles.lastPlay} numberOfLines={2}>
          {result.lastPlay}
        </Text>
      )}
    </View>
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
      <View style={styles.chips}>
        <Text style={styles.chipsNote}>
          {withPicks.length} {withPicks.length === 1 ? 'pick' : 'picks'} in — revealed when the
          slate locks at the first kickoff
        </Text>
      </View>
    );
  }

  const commissionerPreview = isCommissioner && !picksLocked;
  const margin = result ? coverMargin(slateGame.homeSpread, result) : null;
  const started = !!result && result.state !== 'pre';
  return (
    <View style={styles.chips}>
      {commissionerPreview && (
        <Text style={styles.chipsNote}>
          {withPicks.length} of {entries.length} {withPicks.length === 1 ? 'pick' : 'picks'} in ·
          visible to you as commissioner
        </Text>
      )}
      {withPicks.map((entry) => {
        const side = entry.picks[slateGame.gameId];
        const team = side === 'home' ? game.home : game.away;
        const grade = gradeAts(side, slateGame, result);
        let tone: keyof typeof chipTones = 'neutral';
        if (grade === 'win') tone = 'win';
        else if (grade === 'loss') tone = 'loss';
        else if (grade === 'push') tone = 'push';
        else if (started && margin != null) {
          tone = (side === 'home') === margin > 0 ? 'ahead' : margin === 0 ? 'push' : 'behind';
        }
        const t = chipTones[tone];
        return (
          <View
            key={entry.playerId}
            style={[
              styles.chip,
              { backgroundColor: t.bg, borderColor: t.border },
              entry.playerId === currentPlayerId && styles.chipMe,
            ]}
          >
            <Text style={[styles.chipText, { color: t.text }]}>
              {entry.playerName} · {team?.abbrev ?? team?.school ?? side}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const chipTones = {
  neutral: { bg: colors.card, border: colors.border, text: colors.textDim },
  win: { bg: colors.greenSoft, border: colors.greenBorder, text: colors.green },
  loss: { bg: colors.redSoft, border: colors.red, text: colors.red },
  push: { bg: colors.amberSoft, border: colors.amber, text: colors.amber },
  ahead: { bg: colors.greenSoft, border: colors.greenBorder, text: colors.green },
  behind: { bg: colors.card, border: colors.border, text: colors.textDim },
};

const styles = StyleSheet.create({
  list: {
    paddingTop: 12,
  },
  item: {
    marginBottom: 8,
  },
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
  liveSituation: {
    marginHorizontal: 16,
    marginTop: -6,
    marginBottom: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  redzone: {
    borderColor: colors.red,
  },
  liveLine: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  lastPlay: {
    fontSize: 12,
    color: colors.textDim,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  chipsNote: {
    fontSize: 12,
    color: colors.textDim,
    width: '100%',
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  chipMe: {
    borderWidth: 2,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
