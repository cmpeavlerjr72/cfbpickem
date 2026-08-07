// Mirrors web/src/components/GameCard.tsx (see CLAUDE.md parity rule)

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Game, Team } from '../types';
import type { GameResult, PickGrade } from '../results';
import { gradePick } from '../results';
import { colors } from '../theme';

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
  return (
    <Pressable
      style={[
        styles.teamRow,
        picked && !lost && styles.teamRowPicked,
        picked && lost && styles.teamRowPickedLoss,
        !selectable && !picked && styles.teamRowDisabled,
      ]}
      onPress={onSelect}
      disabled={!selectable}
    >
      {team.logo ? (
        <Image style={styles.teamLogo} source={{ uri: team.logo }} />
      ) : (
        <View style={[styles.teamLogo, styles.teamLogoPlaceholder]}>
          <Text style={styles.teamLogoLetter}>{team.school.charAt(0)}</Text>
        </View>
      )}
      <View style={styles.teamName}>
        {team.rank != null && <Text style={styles.teamRank}>#{team.rank}</Text>}
        <Text style={styles.teamSchool} numberOfLines={1}>
          {team.school}
        </Text>
        {team.mascot && (
          <Text style={styles.teamMascot} numberOfLines={1}>
            {team.mascot}
          </Text>
        )}
      </View>
      {showScore && score != null && (
        <Text style={[styles.score, isWinner ? styles.scoreWinner : styles.scoreLoser]}>
          {score}
        </Text>
      )}
      <View
        style={[
          styles.pickIndicator,
          picked && !lost && styles.pickIndicatorOn,
          picked && lost && styles.pickIndicatorLoss,
        ]}
      >
        {picked && <Text style={styles.pickCheck}>{lost ? '✗' : '✓'}</Text>}
      </View>
    </Pressable>
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
    <View style={styles.card}>
      <View style={styles.meta}>
        <Text style={[styles.time, live && styles.timeLive]}>
          {started ? result.detail ?? 'In progress' : formatKickoff(game.date)}
        </Text>
        {game.conferenceGame && !started && (
          <View style={styles.confBadge}>
            <Text style={styles.confBadgeText}>Conf</Text>
          </View>
        )}
        {locked && !started && (
          <View style={styles.lockBadge}>
            <Text style={styles.lockBadgeText}>Locked</Text>
          </View>
        )}
        {!started && <Text style={styles.tv}>{game.broadcast ?? 'TV TBD'}</Text>}
      </View>
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
      <View style={styles.separator}>
        <View style={styles.separatorLine} />
        <Text style={styles.separatorText}>{game.neutralSite ? 'VS' : 'AT'}</Text>
        <View style={styles.separatorLine} />
      </View>
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
      {venueBits.length > 0 && (
        <Text style={styles.venue} numberOfLines={1}>
          {venueBits.join(' · ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  time: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  timeLive: {
    color: colors.red,
  },
  confBadge: {
    backgroundColor: '#eef2ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  confBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338ca',
    textTransform: 'uppercase',
  },
  lockBadge: {
    backgroundColor: colors.bg,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  lockBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textDim,
    textTransform: 'uppercase',
  },
  tv: {
    marginLeft: 'auto',
    fontSize: 12,
    color: colors.textDim,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
  },
  teamRowPicked: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
  },
  teamRowPickedLoss: {
    backgroundColor: colors.redSoft,
    borderColor: colors.red,
  },
  teamRowDisabled: {
    opacity: 0.6,
  },
  teamLogo: {
    width: 30,
    height: 30,
  },
  teamLogoPlaceholder: {
    borderRadius: 15,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamLogoLetter: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textDim,
  },
  teamName: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    flex: 1,
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
  teamMascot: {
    fontSize: 12,
    color: colors.textDim,
    flexShrink: 1,
  },
  score: {
    fontSize: 16,
    fontWeight: '800',
  },
  scoreWinner: {
    color: colors.text,
  },
  scoreLoser: {
    color: colors.textDim,
  },
  pickIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickIndicatorOn: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  pickIndicatorLoss: {
    backgroundColor: colors.red,
    borderColor: colors.red,
  },
  pickCheck: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  separator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  separatorLine: {
    flex: 1,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  separatorText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textDim,
  },
  venue: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textDim,
  },
});
