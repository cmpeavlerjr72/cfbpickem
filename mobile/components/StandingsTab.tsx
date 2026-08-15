// Weekly leaderboard + season standings — mirrors
// web/src/components/StandingsTab.tsx (see CLAUDE.md parity rule).

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SeasonData } from '../types';
import { getWeekResults } from '../results';
import type { PoolSettings } from '../pool/types';
import type { PoolStore } from '../pool/store';
import type { EntryScore, ScoredWeek, SeasonRow } from '../pool/scoring';
import { isWeekComplete, scoreWeek, seasonStandings } from '../pool/scoring';
import { colors } from '../theme';

function pointsText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

async function loadScoredWeeks(
  season: SeasonData,
  settings: PoolSettings,
  store: PoolStore,
): Promise<ScoredWeek[]> {
  const out: ScoredWeek[] = [];
  for (const weekData of season.weeks) {
    const slate = await store.getSlate(season.season, weekData.seasonType, weekData.week);
    if (!slate || !slate.published || slate.games.length === 0) continue;
    const entries = await store.getEntries(season.season, weekData.seasonType, weekData.week);
    if (entries.length === 0) continue;
    const results = await getWeekResults(season.season, weekData);
    out.push({
      slate,
      label: weekData.label,
      scores: scoreWeek(slate, entries, results, settings),
      complete: isWeekComplete(slate, results),
    });
  }
  return out;
}

interface StandingsTabProps {
  season: SeasonData;
  settings: PoolSettings;
  store: PoolStore;
  weekIndex: number;
  currentPlayerId: string;
}

export function StandingsTab({
  season,
  settings,
  store,
  weekIndex,
  currentPlayerId,
}: StandingsTabProps) {
  const [view, setView] = useState<'week' | 'season'>('week');
  const [weeks, setWeeks] = useState<ScoredWeek[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadScoredWeeks(season, settings, store).then((w) => {
      if (!cancelled) setWeeks(w);
    });
    return () => {
      cancelled = true;
    };
  }, [season, settings, store, weekIndex]);

  if (!weeks) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Loading standings…</Text>
      </View>
    );
  }

  const weekData = season.weeks[weekIndex];
  const thisWeek =
    weeks.find(
      (w) => w.slate.seasonType === weekData.seasonType && w.slate.week === weekData.week,
    ) ?? null;
  const seasonRows = seasonStandings(weeks);

  return (
    <View style={styles.wrap}>
      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, view === 'week' && styles.toggleBtnActive]}
          onPress={() => setView('week')}
        >
          <Text style={[styles.toggleText, view === 'week' && styles.toggleTextActive]}>
            {weekData.label}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, view === 'season' && styles.toggleBtnActive]}
          onPress={() => setView('season')}
        >
          <Text style={[styles.toggleText, view === 'season' && styles.toggleTextActive]}>
            Season
          </Text>
        </Pressable>
      </View>

      {view === 'week' ? (
        <WeekBoard week={thisWeek} currentPlayerId={currentPlayerId} />
      ) : (
        <SeasonBoard rows={seasonRows} weeks={weeks} currentPlayerId={currentPlayerId} />
      )}
    </View>
  );
}

function WeekBoard({ week, currentPlayerId }: { week: ScoredWeek | null; currentPlayerId: string }) {
  if (!week || week.scores.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Nothing to rank yet</Text>
        <Text style={styles.emptyText}>
          Standings show up once the slate is published and picks are in.
        </Text>
      </View>
    );
  }
  const winners = week.scores.filter((s) => s.rank === 1);
  return (
    <View style={styles.board}>
      {week.complete && (
        <View style={styles.winnerBanner}>
          <Text style={styles.winnerText}>
            👑 {winners.map((s) => s.entry.playerName).join(' & ')}{' '}
            {winners.length > 1 ? 'split' : 'takes'} {week.label}
          </Text>
        </View>
      )}
      <View style={styles.headRow}>
        <Text style={[styles.cell, styles.numCell, styles.headText]}>#</Text>
        <Text style={[styles.cell, styles.nameCell, styles.headText]}>Player</Text>
        <Text style={[styles.cell, styles.numCellWide, styles.headText]}>Pts</Text>
        <Text style={[styles.cell, styles.recordCell, styles.headText]}>W–L–P</Text>
        <Text style={[styles.cell, styles.numCellWide, styles.headText]}>TB</Text>
      </View>
      {week.scores.map((s: EntryScore) => (
        <View
          key={s.entry.playerId}
          style={[styles.row, s.entry.playerId === currentPlayerId && styles.rowMe]}
        >
          <Text style={[styles.cell, styles.numCell]}>{s.rank}</Text>
          <Text style={[styles.cell, styles.nameCell]} numberOfLines={1}>
            {s.entry.playerName}
            {week.complete && s.rank === 1 ? ' 👑' : ''}
          </Text>
          <Text style={[styles.cell, styles.numCellWide, styles.strong]}>
            {pointsText(s.points)}
          </Text>
          <Text style={[styles.cell, styles.recordCell]}>
            {s.wins}–{s.losses}
            {s.pushes > 0 ? `–${s.pushes}` : ''}
            {s.pending > 0 ? ` (${s.pending})` : ''}
          </Text>
          <Text style={[styles.cell, styles.numCellWide]}>{s.tiebreakerError ?? '—'}</Text>
        </View>
      ))}
    </View>
  );
}

function SeasonBoard({
  rows,
  weeks,
  currentPlayerId,
}: {
  rows: SeasonRow[];
  weeks: ScoredWeek[];
  currentPlayerId: string;
}) {
  if (rows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Season standings</Text>
        <Text style={styles.emptyText}>
          Once weeks are in the books, the overall race shows up here.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.board}>
      <Text style={styles.boardSub}>
        {weeks.length} {weeks.length === 1 ? 'week' : 'weeks'} played · total points decide the
        overall prize, weekly wins break ties
      </Text>
      <View style={styles.headRow}>
        <Text style={[styles.cell, styles.numCell, styles.headText]}>#</Text>
        <Text style={[styles.cell, styles.nameCell, styles.headText]}>Player</Text>
        <Text style={[styles.cell, styles.numCellWide, styles.headText]}>Pts</Text>
        <Text style={[styles.cell, styles.numCell, styles.headText]}>👑</Text>
        <Text style={[styles.cell, styles.recordCell, styles.headText]}>W–L–P</Text>
      </View>
      {rows.map((r) => (
        <View key={r.playerId} style={[styles.row, r.playerId === currentPlayerId && styles.rowMe]}>
          <Text style={[styles.cell, styles.numCell]}>{r.rank}</Text>
          <Text style={[styles.cell, styles.nameCell]} numberOfLines={1}>
            {r.playerName}
          </Text>
          <Text style={[styles.cell, styles.numCellWide, styles.strong]}>
            {pointsText(r.totalPoints)}
          </Text>
          <Text style={[styles.cell, styles.numCell]}>{r.weeklyWins || '—'}</Text>
          <Text style={[styles.cell, styles.recordCell]}>
            {r.wins}–{r.losses}
            {r.pushes > 0 ? `–${r.pushes}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
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
  toggle: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 4,
    marginBottom: 14,
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: colors.navy,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textDim,
  },
  toggleTextActive: {
    color: '#fff',
  },
  board: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  boardSub: {
    fontSize: 12,
    color: colors.textDim,
    textAlign: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  winnerBanner: {
    backgroundColor: colors.greenSoft,
    borderBottomWidth: 1,
    borderColor: colors.greenBorder,
    padding: 10,
  },
  winnerText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
    textAlign: 'center',
  },
  headRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  headText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: colors.textDim,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  rowMe: {
    backgroundColor: colors.greenSoft,
  },
  cell: {
    fontSize: 13,
    color: colors.text,
  },
  numCell: {
    width: 28,
    textAlign: 'center',
  },
  numCellWide: {
    width: 44,
    textAlign: 'center',
  },
  recordCell: {
    width: 72,
    textAlign: 'center',
  },
  nameCell: {
    flex: 1,
    fontWeight: '600',
  },
  strong: {
    fontWeight: '800',
  },
});
