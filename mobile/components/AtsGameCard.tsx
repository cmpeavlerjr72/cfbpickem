// Pick-sheet card — mirrors web/src/components/AtsGameCard.tsx (see
// CLAUDE.md parity rule): pick a side against the locked spread, live cover
// state while games run, win/loss/push once final, Kalshi odds when present.

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Game, Team } from '../types';
import type { GameResult } from '../results';
import type { CoverOdds, PickSide, PickType, SlateGame } from '../pool/types';
import { formatSpread } from '../pool/types';
import { coverMargin, gradeAts } from '../pool/scoring';
import { colors } from '../theme';

export type { CoverOdds };

function formatKickoff(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

interface AtsTeamRowProps {
  team: Team;
  spread: number;
  showSpread: boolean;
  coveringLabel: string;
  picked: boolean;
  locked: boolean;
  score: number | null;
  showScore: boolean;
  covering: boolean | null;
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
  return (
    <Pressable
      style={[
        styles.teamRow,
        picked && !lost && !push && styles.teamRowPicked,
        picked && lost && styles.teamRowLoss,
        picked && push && styles.teamRowPush,
      ]}
      onPress={onSelect}
      disabled={!selectable}
    >
      {team.logo ? (
        <Image source={{ uri: team.logo }} style={styles.teamLogo} />
      ) : (
        <View style={[styles.teamLogo, styles.logoPlaceholder]}>
          <Text style={styles.logoPlaceholderText}>{team.school.charAt(0)}</Text>
        </View>
      )}
      <View style={styles.teamName}>
        {team.rank != null && <Text style={styles.teamRank}>#{team.rank}</Text>}
        <Text style={styles.teamSchool} numberOfLines={1}>
          {team.school}
        </Text>
        {showSpread && <Text style={styles.teamSpread}>{formatSpread(spread)}</Text>}
      </View>
      {odds != null && <Text style={styles.coverOdds}>{Math.round(odds * 100)}%</Text>}
      {showScore && score != null && (
        <Text style={[styles.score, covering === true && styles.scoreWinner]}>{score}</Text>
      )}
      {showScore && covering === true && !final && (
        <Text style={styles.coveringTag}>{coveringLabel}</Text>
      )}
      <View
        style={[
          styles.pickIndicator,
          picked && !lost && !(push && final) && styles.pickIndicatorOn,
          picked && lost && styles.pickIndicatorLoss,
          picked && push && final && styles.pickIndicatorPush,
        ]}
      >
        <Text style={styles.pickIndicatorText}>
          {picked ? (lost ? '✗' : final && push ? '=' : '✓') : ''}
        </Text>
      </View>
    </Pressable>
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

  return (
    <View style={[styles.card, slateGame.isTiebreaker && styles.tiebreakerCard]}>
      <View style={styles.meta}>
        <Text style={[styles.gameTime, live && styles.gameTimeLive]}>
          {started ? result!.detail ?? 'In progress' : formatKickoff(game.date)}
        </Text>
        {slateGame.isTiebreaker && <Text style={styles.tbBadge}>GameDay TB</Text>}
        {locked && !started && <Text style={styles.lockBadge}>Locked</Text>}
        {final && grade === 'push' && <Text style={styles.pushBadge}>Push</Text>}
        {!started && <Text style={styles.gameTv}>{game.broadcast ?? 'TV TBD'}</Text>}
      </View>
      <AtsTeamRow
        team={away}
        spread={-slateGame.homeSpread}
        showSpread={ats}
        coveringLabel={coveringLabel}
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
      <View style={styles.separator}>
        <Text style={styles.separatorText}>{game.neutralSite ? 'vs' : 'at'}</Text>
      </View>
      <AtsTeamRow
        team={home}
        spread={slateGame.homeSpread}
        showSpread={ats}
        coveringLabel={coveringLabel}
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
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 12,
  },
  tiebreakerCard: {
    borderColor: colors.amber,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  gameTime: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  gameTimeLive: {
    color: colors.red,
  },
  tbBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.amber,
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  lockBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textDim,
    backgroundColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  pushBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.amber,
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  gameTv: {
    fontSize: 11,
    color: colors.textDim,
    marginLeft: 'auto',
  },
  separator: {
    alignItems: 'center',
    marginVertical: 4,
  },
  separatorText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textDim,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  teamRowPicked: {
    borderColor: colors.green,
    backgroundColor: colors.greenSoft,
  },
  teamRowLoss: {
    borderColor: colors.red,
    backgroundColor: colors.redSoft,
  },
  teamRowPush: {
    borderColor: colors.amber,
    backgroundColor: colors.amberSoft,
  },
  teamLogo: {
    width: 28,
    height: 28,
  },
  logoPlaceholder: {
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholderText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textDim,
  },
  teamName: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  teamRank: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  teamSchool: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  teamSpread: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.navyLight,
  },
  coverOdds: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  score: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.textDim,
    minWidth: 28,
    textAlign: 'right',
  },
  scoreWinner: {
    color: colors.text,
  },
  coveringTag: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.green,
  },
  pickIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  pickIndicatorOn: {
    borderColor: colors.green,
    backgroundColor: colors.green,
  },
  pickIndicatorLoss: {
    borderColor: colors.red,
    backgroundColor: colors.red,
  },
  pickIndicatorPush: {
    borderColor: colors.amber,
    backgroundColor: colors.amber,
  },
  pickIndicatorText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
  },
});
