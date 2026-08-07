// Mirrors web/src/App.tsx (see CLAUDE.md parity rule)

import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import gamesJson from './assets/games.json';
import type { Game, Picks, SeasonData, WeekData } from './types';
import { picksStorageKey } from './types';
import type { WeekResults } from './results';
import { getWeekResults, isGameLocked } from './results';
import { GameCard } from './components/GameCard';
import { ResultsTab } from './components/ResultsTab';
import { colors } from './theme';

const season = gamesJson as SeasonData;

// Default to the first week that hasn't fully finished yet.
function defaultWeekIndex(weeks: WeekData[]): number {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const idx = weeks.findIndex((w) =>
    w.games.some((g) => new Date(g.date).getTime() > cutoff),
  );
  return idx === -1 ? 0 : idx;
}

type Tab = 'picks' | 'results';

export default function App() {
  const [tab, setTab] = useState<Tab>('picks');
  const [weekIndex, setWeekIndex] = useState(() => defaultWeekIndex(season.weeks));
  const week = season.weeks[weekIndex];
  const storageKey = picksStorageKey(season.season, week.seasonType, week.week);
  const [picks, setPicks] = useState<Picks>({});
  const [weekResults, setWeekResults] = useState<WeekResults>({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWeekResults({});
    getWeekResults(season.season, week).then((r) => {
      if (!cancelled) setWeekResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [week]);

  const refreshResults = () => {
    setRefreshing(true);
    getWeekResults(season.season, week)
      .then(setWeekResults)
      .finally(() => setRefreshing(false));
  };

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!cancelled) setPicks(raw ? (JSON.parse(raw) as Picks) : {});
      })
      .catch(() => {
        if (!cancelled) setPicks({});
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const handlePick = (gameId: string, teamId: string) => {
    const game = week.games.find((g) => g.id === gameId);
    if (!game || isGameLocked(game, weekResults[gameId])) return;
    setPicks((prev) => {
      const next = { ...prev };
      if (next[gameId] === teamId) delete next[gameId];
      else next[gameId] = teamId;
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const dayGroups = useMemo(() => {
    const sorted = [...week.games].sort((a, b) => a.date.localeCompare(b.date));
    const groups: { title: string; data: Game[] }[] = [];
    for (const game of sorted) {
      const title = new Date(game.date).toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      const last = groups[groups.length - 1];
      if (last && last.title === title) last.data.push(game);
      else groups.push({ title, data: [game] });
    }
    return groups;
  }, [week]);

  const pickedCount = week.games.filter((g) => picks[g.id]).length;
  const allPicked = pickedCount === week.games.length;

  const handleSubmit = () => {
    Alert.alert(
      allPicked ? 'Picks locked in! 🔒' : 'Picks saved',
      allPicked
        ? `All ${pickedCount} picks locked in for ${week.label}.`
        : `${pickedCount} picks saved for ${week.label}. You can still change them until kickoff.`,
    );
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <View style={styles.brand}>
            <Text style={styles.logo}>🏈</Text>
            <Text style={styles.title}>CFB Pick'em</Text>
            <Text style={styles.seasonBadge}>{season.season} Season</Text>
          </View>
        </View>

        <View style={styles.body}>
          {tab === 'picks' ? (
            <>
              <View style={styles.weekPicker}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.weekPickerContent}
                >
                  {season.weeks.map((w, i) => (
                    <Pressable
                      key={`${w.seasonType}-${w.week}`}
                      style={[styles.weekPill, i === weekIndex && styles.weekPillActive]}
                      onPress={() => setWeekIndex(i)}
                    >
                      <Text
                        style={[
                          styles.weekPillText,
                          i === weekIndex && styles.weekPillTextActive,
                        ]}
                      >
                        {w.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <SectionList
                sections={dayGroups}
                keyExtractor={(game) => game.id}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={refreshResults} />
                }
                renderItem={({ item }) => (
                  <GameCard
                    game={item}
                    result={weekResults[item.id]}
                    locked={isGameLocked(item, weekResults[item.id])}
                    pickedTeamId={picks[item.id] ?? null}
                    onPick={handlePick}
                  />
                )}
                renderSectionHeader={({ section }) => (
                  <Text style={styles.dayHeader}>{section.title}</Text>
                )}
                stickySectionHeadersEnabled={false}
                contentContainerStyle={styles.gameList}
              />

              <View style={styles.pickBar}>
                <View style={styles.pickProgress}>
                  <Text style={styles.pickCount}>
                    {pickedCount} of {week.games.length} picks made
                  </Text>
                  <View style={styles.pickMeter}>
                    <View
                      style={[
                        styles.pickMeterFill,
                        {
                          width: `${(pickedCount / Math.max(week.games.length, 1)) * 100}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
                <Pressable
                  style={[styles.submitBtn, pickedCount === 0 && styles.submitBtnDisabled]}
                  disabled={pickedCount === 0}
                  onPress={handleSubmit}
                >
                  <Text
                    style={[
                      styles.submitBtnText,
                      pickedCount === 0 && styles.submitBtnTextDisabled,
                    ]}
                  >
                    {allPicked ? 'Lock In Picks' : 'Save Picks'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <ResultsTab season={season} />
          )}
        </View>

        <View style={styles.tabBar}>
          <Pressable style={styles.tabBtn} onPress={() => setTab('picks')}>
            <Text style={[styles.tabText, tab === 'picks' && styles.tabTextActive]}>
              My Picks
            </Text>
          </Pressable>
          <Pressable style={styles.tabBtn} onPress={() => setTab('results')}>
            <Text style={[styles.tabText, tab === 'results' && styles.tabTextActive]}>
              Results
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.navy,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  logo: {
    fontSize: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
  },
  seasonBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.navyMuted,
  },
  body: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  weekPicker: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  weekPickerContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  weekPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: colors.card,
  },
  weekPillActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  weekPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  weekPillTextActive: {
    color: '#fff',
  },
  gameList: {
    paddingBottom: 16,
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
  pickBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickProgress: {
    flex: 1,
  },
  pickCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  pickMeter: {
    marginTop: 6,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 999,
    overflow: 'hidden',
  },
  pickMeterFill: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 999,
  },
  submitBtn: {
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  submitBtnDisabled: {
    backgroundColor: colors.border,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  submitBtnTextDisabled: {
    color: colors.textDim,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.navy,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navyMuted,
  },
  tabTextActive: {
    color: '#fff',
  },
});
