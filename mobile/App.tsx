// Mirrors web/src/App.tsx + Root.tsx (see CLAUDE.md parity rule): AuthGate →
// league switcher (dashboard when no league selected, remembered per device)
// → the pool app, including the commissioner's Slate tab. Mobile is
// Supabase-only (client config is baked in, so there's no local fallback
// mode). The lazy Monday spread-lock path is web-only (the hourly Edge
// Function cron covers it server-side).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import gamesJson from './assets/games.json';
import type { Game, SeasonData, WeekData } from './types';
import { fetchWeekScoreboard, isGameLocked } from './results';
import { useWeekResults } from './live';
import { useOtaUpdates } from './useOtaUpdates';
import type { CoverOdds, PickSide, PoolEntry, PoolProfile, PoolSettings, WeekSlate } from './pool/types';
import { DEFAULT_SETTINGS } from './pool/types';
import type { PoolStore } from './pool/store';
import { SupabasePoolStore } from './pool/store';
import { fetchCoverOddsForSlate } from './pool/kalshi';
import { AuthGate, type AccountContext } from './components/AuthGate';
import { Dashboard } from './components/Dashboard';
import { PickSheet } from './components/PickSheet';
import { ScoreboardTab } from './components/ScoreboardTab';
import { SlateBuilder } from './components/SlateBuilder';
import { StandingsTab } from './components/StandingsTab';
import { colors } from './theme';

const season = gamesJson as SeasonData;
const LAST_POOL_KEY = 'cfb-pickem:pool:last';

// Default to the first week that hasn't fully finished yet.
function defaultWeekIndex(weeks: WeekData[]): number {
  const cutoff = Date.now() - 12 * 60 * 60 * 1000;
  const idx = weeks.findIndex((w) =>
    w.games.some((g) => new Date(g.date).getTime() > cutoff),
  );
  return idx === -1 ? 0 : idx;
}

type Tab = 'picks' | 'board' | 'standings' | 'slate';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthGate>{(account) => <LeagueSwitcher account={account} />}</AuthGate>
      <OtaBanner />
    </SafeAreaProvider>
  );
}

// Sits above everything (including the sign-in screen) so a player is never
// stuck running a stale bundle just because they haven't force-quit the app
// in a while — see useOtaUpdates.ts for the check/download/reload logic.
function OtaBanner() {
  const { updateReady, restart } = useOtaUpdates();
  const insets = useSafeAreaInsets();
  if (!updateReady) return null;
  return (
    <View style={[styles.otaBanner, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.otaBannerRow}>
        <Text style={styles.otaBannerText}>New version ready</Text>
        <Pressable style={styles.otaBannerBtn} onPress={restart}>
          <Text style={styles.otaBannerBtnText}>Restart</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LeagueSwitcher({ account }: { account: AccountContext }) {
  const [state, setState] = useState<{ loaded: boolean; poolId: string | null }>({
    loaded: false,
    poolId: null,
  });

  // Restore the remembered league once; a single league auto-enters.
  useEffect(() => {
    AsyncStorage.getItem(LAST_POOL_KEY)
      .catch(() => null)
      .then((remembered) => {
        setState((prev) => {
          if (prev.loaded) return prev;
          const valid =
            remembered && account.memberships.some((m) => m.poolId === remembered)
              ? remembered
              : account.memberships.length === 1
                ? account.memberships[0].poolId
                : null;
          return { loaded: true, poolId: valid };
        });
      });
  }, [account]);

  const select = (id: string | null) => {
    setState({ loaded: true, poolId: id });
    if (id) AsyncStorage.setItem(LAST_POOL_KEY, id).catch(() => {});
    else AsyncStorage.removeItem(LAST_POOL_KEY).catch(() => {});
  };

  const membership = account.memberships.find((m) => m.poolId === state.poolId) ?? null;

  const profile = useMemo<PoolProfile | null>(
    () =>
      membership
        ? {
            playerId: account.userId,
            playerName: account.displayName,
            isCommissioner: membership.isCommissioner,
          }
        : null,
    [membership, account.userId, account.displayName],
  );

  const store = useMemo(
    () => (membership && profile ? new SupabasePoolStore(membership.poolId, profile) : null),
    [membership, profile],
  );

  if (!state.loaded) return null;
  if (!membership || !profile || !store) {
    return <Dashboard account={account} onSelect={select} />;
  }

  return (
    <PoolApp
      key={membership.poolId}
      store={store}
      profile={profile}
      poolName={membership.poolName}
      inviteCode={membership.inviteCode}
      onSwitchLeague={() => select(null)}
    />
  );
}

interface PoolAppProps {
  store: PoolStore;
  profile: PoolProfile;
  poolName: string;
  inviteCode?: string;
  onSwitchLeague: () => void;
}

function PoolApp({ store, profile, poolName, inviteCode, onSwitchLeague }: PoolAppProps) {
  const [settings, setSettings] = useState<PoolSettings>({ ...DEFAULT_SETTINGS, name: poolName });
  const [tab, setTab] = useState<Tab>('picks');
  const [weekIndex, setWeekIndex] = useState(() => defaultWeekIndex(season.weeks));
  const week = season.weeks[weekIndex];
  const [slate, setSlate] = useState<WeekSlate | null>(null);
  const [entries, setEntries] = useState<PoolEntry[]>([]);
  const [coverOdds, setCoverOdds] = useState<Record<string, CoverOdds>>({});
  const results = useWeekResults(season.season, week);

  // Ticks every 30s so the slate lock flips on time without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    store.getSettings().then(setSettings);
  }, [store]);

  // Pool roster, for the commissioner's "enter picks for…" override.
  const [members, setMembers] = useState<PoolProfile[]>([]);
  useEffect(() => {
    if (profile.isCommissioner) store.getMembers().then(setMembers);
  }, [store, profile.isCommissioner]);

  const refresh = useCallback(async () => {
    const [s, e] = await Promise.all([
      store.getSlate(season.season, week.seasonType, week.week),
      store.getEntries(season.season, week.seasonType, week.week),
    ]);
    setSlate(s);
    setEntries(e);
  }, [store, week]);

  // Load on week change, then keep fresh with a 60s poll.
  useEffect(() => {
    setSlate(null);
    setEntries([]);
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  // The whole slate hard-locks at the week's first kickoff — after that no
  // picks can be added or changed (the entries trigger enforces the same
  // rule server-side; only a commissioner override gets past it).
  const picksLockAt = useMemo(() => {
    if (!slate?.published || slate.games.length === 0) return null;
    const kicks = slate.games
      .map((g) => gamesById.get(g.gameId)?.date)
      .filter((d): d is string => !!d)
      .sort();
    return kicks[0] ? new Date(kicks[0]) : null;
  }, [slate, gamesById]);
  const picksLocked = useMemo(() => {
    if (!slate?.published) return false;
    if (picksLockAt && now >= picksLockAt.getTime()) return true;
    return slate.games.some((g) => {
      const r = results[g.gameId];
      return !!r && r.state !== 'pre';
    });
  }, [slate, picksLockAt, now, results]);

  // Kalshi cover odds: refresh every minute while a published slate is open.
  useEffect(() => {
    setCoverOdds({});
    if (!slate?.published || slate.games.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const odds = await fetchCoverOddsForSlate(slate, gamesById);
      if (!cancelled) setCoverOdds(odds);
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slate, gamesById]);

  // Pre-lock, spreads float with the market: overlay ESPN's current lines
  // for display (grading always uses the stored, locked numbers).
  const [liveLines, setLiveLines] = useState<Record<string, number>>({});
  useEffect(() => {
    setLiveLines({});
    if (!slate || slate.pickType === 'su' || slate.spreadsLockedAt || slate.games.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const r = await fetchWeekScoreboard(season.season, week);
      if (cancelled) return;
      const lines: Record<string, number> = {};
      for (const g of slate.games) {
        const s = r[g.gameId]?.odds?.spread;
        if (s != null) lines[g.gameId] = s;
      }
      setLiveLines(lines);
    };
    load();
    const timer = setInterval(load, 30 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [slate, week]);

  const displaySlate = useMemo<WeekSlate | null>(() => {
    if (!slate || Object.keys(liveLines).length === 0) return slate;
    return {
      ...slate,
      games: slate.games.map((g) =>
        liveLines[g.gameId] != null ? { ...g, homeSpread: liveLines[g.gameId] } : g,
      ),
    };
  }, [slate, liveLines]);

  // Whose sheet the Picks tab is editing: yours, or — commissioner only —
  // any member's (for picks texted in by people who forgot). Commissioner
  // edits of OTHER sheets bypass the slate lock; their own never does.
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => setEditingId(null), [weekIndex]);
  const editingMember =
    profile.isCommissioner && editingId && editingId !== profile.playerId
      ? (members.find((m) => m.playerId === editingId) ?? null)
      : null;
  const overriding = editingMember != null;
  const activeProfile = editingMember ?? profile;

  const activeEntry = useMemo<PoolEntry>(() => {
    const existing = entries.find((e) => e.playerId === activeProfile.playerId);
    return (
      existing ?? {
        playerId: activeProfile.playerId,
        playerName: activeProfile.playerName,
        picks: {},
        tiebreaker: null,
        updatedAt: '',
      }
    );
  }, [entries, activeProfile]);

  const saveActiveEntry = (mutate: (entry: PoolEntry) => PoolEntry) => {
    const next = { ...mutate(activeEntry), updatedAt: new Date().toISOString() };
    setEntries((prev) => {
      const others = prev.filter((e) => e.playerId !== next.playerId);
      return [...others, next];
    });
    store.saveEntry(season.season, week.seasonType, week.week, next).catch((err) => {
      Alert.alert(
        'Pick not saved',
        err instanceof Error && err.message.includes('locked')
          ? 'Too late — picks are locked for this week (first game kicked off).'
          : `Couldn’t save the pick: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refresh();
    });
  };

  const handlePick = (gameId: string, side: PickSide) => {
    const game = gamesById.get(gameId);
    if (!game || !slate?.published) return;
    if (!overriding && (picksLocked || isGameLocked(game, results[gameId]))) return;
    saveActiveEntry((entry) => {
      const picks = { ...entry.picks };
      if (picks[gameId] === side) delete picks[gameId];
      else picks[gameId] = side;
      return { ...entry, picks };
    });
  };

  const handleTiebreaker = (home: number | null, away: number | null) => {
    if (!overriding && picksLocked) return;
    saveActiveEntry((entry) => ({
      ...entry,
      tiebreaker: home == null && away == null ? null : { home: home ?? 0, away: away ?? 0 },
    }));
  };

  const handleSlateSave = (s: WeekSlate) => {
    setSlate(s);
    store.saveSlate(s).catch((err) => {
      Alert.alert(
        'Slate not saved',
        `Couldn’t save the slate: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      refresh();
    });
  };

  const handleSettingsSave = (s: PoolSettings) => {
    setSettings(s);
    store.saveSettings(s).catch((err) => {
      Alert.alert(
        'Settings not saved',
        `Couldn’t save settings: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      store.getSettings().then(setSettings);
    });
  };

  const slateGameIds = slate?.published ? slate.games.map((g) => g.gameId) : [];
  const pickedCount = slateGameIds.filter((id) => activeEntry.picks[id]).length;
  const allPicked = slateGameIds.length > 0 && pickedCount === slateGameIds.length;
  const tiebreakerSet = activeEntry.tiebreaker != null;
  const showPickBar = tab === 'picks' && slateGameIds.length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <Text style={styles.logo}>🏈</Text>
          <Text style={styles.title} numberOfLines={1}>
            {settings.name}
          </Text>
          <Pressable onPress={onSwitchLeague}>
            <Text style={styles.signOut}>Leagues</Text>
          </Pressable>
        </View>
        <Text style={styles.headerSub}>
          {season.season} Season · {profile.playerName}
          {profile.isCommissioner && inviteCode ? ` · invite ${inviteCode}` : ''}
        </Text>
      </View>

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
              <Text style={[styles.weekPillText, i === weekIndex && styles.weekPillTextActive]}>
                {w.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.body}>
        {tab === 'picks' && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {profile.isCommissioner && members.length > 1 && (
              <View style={styles.commishBar}>
                <Text style={styles.commishLabel}>Entering picks for</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.commishChips}>
                    {[profile, ...members.filter((m) => m.playerId !== profile.playerId)].map(
                      (m) => (
                        <Pressable
                          key={m.playerId}
                          style={[
                            styles.commishChip,
                            m.playerId === activeProfile.playerId && styles.commishChipActive,
                          ]}
                          onPress={() => setEditingId(m.playerId)}
                        >
                          <Text
                            style={[
                              styles.commishChipText,
                              m.playerId === activeProfile.playerId &&
                                styles.commishChipTextActive,
                            ]}
                          >
                            {m.playerId === profile.playerId ? `${profile.playerName} (you)` : m.playerName}
                          </Text>
                        </Pressable>
                      ),
                    )}
                  </View>
                </ScrollView>
                {overriding && (
                  <Text style={styles.commishNote}>
                    Commissioner override — the lock doesn’t apply here. Only enter picks the
                    player sent you before kickoff.
                  </Text>
                )}
              </View>
            )}
            <PickSheet
              week={week}
              slate={displaySlate}
              entry={activeEntry}
              results={results}
              coverOdds={coverOdds}
              picksLockAt={picksLockAt}
              picksLocked={picksLocked}
              overriding={overriding}
              onPick={handlePick}
              onTiebreaker={handleTiebreaker}
            />
          </ScrollView>
        )}
        {tab === 'board' && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <ScoreboardTab
              week={week}
              slate={displaySlate}
              entries={entries}
              results={results}
              coverOdds={coverOdds}
              picksLocked={picksLocked}
              currentPlayerId={profile.playerId}
            />
          </ScrollView>
        )}
        {tab === 'standings' && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <StandingsTab
              season={season}
              settings={settings}
              store={store}
              weekIndex={weekIndex}
              currentPlayerId={profile.playerId}
            />
          </ScrollView>
        )}
        {tab === 'slate' && profile.isCommissioner && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <SlateBuilder
              week={week}
              slate={slate}
              settings={settings}
              season={season.season}
              inviteCode={inviteCode}
              onSave={handleSlateSave}
              onSaveSettings={handleSettingsSave}
            />
          </ScrollView>
        )}
      </View>

      {showPickBar && (
        <View style={styles.pickBar}>
          <View style={styles.pickProgress}>
            <Text style={styles.pickCount}>
              {pickedCount} of {slateGameIds.length} picks
              {tiebreakerSet ? ' · TB in' : ' · TB missing'}
            </Text>
            <View style={styles.pickMeter}>
              <View
                style={[
                  styles.pickMeterFill,
                  { width: `${(pickedCount / Math.max(slateGameIds.length, 1)) * 100}%` },
                ]}
              />
            </View>
          </View>
          <Pressable
            style={[styles.submitBtn, pickedCount === 0 && styles.submitBtnDisabled]}
            disabled={pickedCount === 0}
            onPress={() =>
              Alert.alert(
                allPicked && tiebreakerSet ? 'Sheet complete 🔒' : 'Picks saved',
                allPicked && tiebreakerSet
                  ? `${pickedCount} picks + tiebreaker in for ${week.label}!`
                  : `${pickedCount}/${slateGameIds.length} picks saved${tiebreakerSet ? '' : ' — don’t forget the tiebreaker'}. You can change them until the first game kicks off.`,
              )
            }
          >
            <Text
              style={[styles.submitBtnText, pickedCount === 0 && styles.submitBtnTextDisabled]}
            >
              {allPicked && tiebreakerSet ? 'Sheet Complete' : 'Save Picks'}
            </Text>
          </Pressable>
        </View>
      )}

      <View style={styles.tabBar}>
        <Pressable style={styles.tabBtn} onPress={() => setTab('picks')}>
          <Text style={[styles.tabText, tab === 'picks' && styles.tabTextActive]}>My Picks</Text>
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => setTab('board')}>
          <Text style={[styles.tabText, tab === 'board' && styles.tabTextActive]}>Scoreboard</Text>
        </Pressable>
        <Pressable style={styles.tabBtn} onPress={() => setTab('standings')}>
          <Text style={[styles.tabText, tab === 'standings' && styles.tabTextActive]}>
            Standings
          </Text>
        </Pressable>
        {profile.isCommissioner && (
          <Pressable style={styles.tabBtn} onPress={() => setTab('slate')}>
            <Text style={[styles.tabText, tab === 'slate' && styles.tabTextActive]}>Slate</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  otaBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: colors.navy,
    borderBottomWidth: 1,
    borderColor: colors.navyLight,
  },
  otaBannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  otaBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  otaBannerBtn: {
    backgroundColor: colors.green,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  otaBannerBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.navy,
  },
  header: {
    backgroundColor: colors.navy,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    fontSize: 20,
  },
  title: {
    flex: 1,
    fontSize: 19,
    fontWeight: '800',
    color: '#fff',
  },
  signOut: {
    fontSize: 12,
    color: colors.navyMuted,
    textDecorationLine: 'underline',
  },
  headerSub: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: colors.navyMuted,
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
  body: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  commishBar: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    gap: 8,
  },
  commishLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  commishChips: {
    flexDirection: 'row',
    gap: 6,
  },
  commishChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.card,
  },
  commishChipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  commishChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  commishChipTextActive: {
    color: '#fff',
  },
  commishNote: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.amber,
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
