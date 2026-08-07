// Season record + week-by-week results, graded from live scores.
// Mirrors web/src/components/ResultsTab.tsx (see CLAUDE.md parity rule)

import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { SeasonData } from '../types';
import type { SeasonSummary, WeekSummary } from '../results';
import { buildSeasonSummary } from '../results';
import { colors } from '../theme';

function recordText(w: WeekSummary): string {
  if (w.picks === 0) return '—';
  if (w.wins + w.losses > 0) {
    return `${w.wins}–${w.losses}${w.pending ? ` · ${w.pending} left` : ''}`;
  }
  return w.started ? 'In progress' : 'Pending';
}

function firstKickoff(season: SeasonData): string {
  const first = Math.min(...season.weeks[0].games.map((g) => new Date(g.date).getTime()));
  return new Date(first).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function ResultsTab({ season }: { season: SeasonData }) {
  const [summary, setSummary] = useState<SeasonSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => buildSeasonSummary(season), [season]);

  useEffect(() => {
    let cancelled = false;
    load().then((s) => {
      if (!cancelled) setSummary(s);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load()
      .then(setSummary)
      .finally(() => setRefreshing(false));
  };

  if (!summary) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>Loading results…</Text>
      </View>
    );
  }

  const rows = summary.weeks.filter((w) => w.picks > 0 || w.started);
  const graded = summary.wins + summary.losses;

  return (
    <FlatList
      data={rows}
      keyExtractor={(w) => `${w.seasonType}-${w.week}`}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.recordCard}>
          <Text style={styles.recordBig}>
            {summary.wins}–{summary.losses}
          </Text>
          <Text style={styles.recordLabel}>Season record</Text>
          <Text style={styles.recordSub}>
            {graded > 0
              ? `${Math.round((summary.wins / graded) * 100)}% correct · ${summary.totalPicks} picks made`
              : `${summary.totalPicks} picks made · nothing graded yet`}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No results yet</Text>
          <Text style={styles.emptyText}>
            Make your picks and they'll be graded automatically as games go final. The season
            kicks off {firstKickoff(season)}.
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.weekRow}>
          <Text style={styles.weekLabel}>{item.label}</Text>
          <Text style={styles.weekPicks}>
            {item.picks} {item.picks === 1 ? 'pick' : 'picks'}
          </Text>
          <Text style={styles.weekRecord}>{recordText(item)}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: 16,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 14,
  },
  recordCard: {
    backgroundColor: colors.navy,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 16,
  },
  recordBig: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '800',
  },
  recordLabel: {
    color: colors.navyMuted,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
  },
  recordSub: {
    color: colors.navyMuted,
    fontSize: 13,
    marginTop: 8,
  },
  empty: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textDim,
    textAlign: 'center',
    lineHeight: 19,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 12,
  },
  weekLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  weekPicks: {
    fontSize: 13,
    color: colors.textDim,
  },
  weekRecord: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    minWidth: 70,
    textAlign: 'right',
  },
});
