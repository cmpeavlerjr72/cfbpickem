// Commissioner tools — mirrors web/src/components/SlateBuilder.tsx (see
// CLAUDE.md parity rule): pool settings (pick style, target size), choose
// the week's slate games, mark the GameDay tiebreaker, and publish. Spreads
// are NOT editable — they track ESPN's line and freeze automatically at
// Monday 12:00 AM ET of game week (see pool/spreads.ts).

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Game, WeekData } from '../types';
import type { WeekResults } from '../results';
import { fetchWeekScoreboard } from '../results';
import type { PoolSettings, SlateGame, WeekSlate } from '../pool/types';
import { formatSpread } from '../pool/types';
import { spreadLockTime } from '../pool/spreads';
import { colors } from '../theme';

function shortMatchup(game: Game): string {
  const away = game.away?.abbrev ?? game.away?.school ?? 'TBD';
  const home = game.home?.abbrev ?? game.home?.school ?? 'TBD';
  return `${away} ${game.neutralSite ? 'vs' : '@'} ${home}`;
}

function kickoffLabel(game: Game): string {
  return new Date(game.date).toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface SlateBuilderProps {
  week: WeekData;
  slate: WeekSlate | null;
  settings: PoolSettings;
  season: number;
  inviteCode?: string;
  onSave: (slate: WeekSlate) => void;
  onSaveSettings: (settings: PoolSettings) => void;
}

interface DraftGame {
  storedSpread: number | null; // last saved home-POV line
  isTiebreaker: boolean;
}

export function SlateBuilder({
  week,
  slate,
  settings,
  season,
  inviteCode,
  onSave,
  onSaveSettings,
}: SlateBuilderProps) {
  const [draft, setDraft] = useState<Map<string, DraftGame>>(new Map());
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [espn, setEspn] = useState<WeekResults>({});
  const [sizeText, setSizeText] = useState(String(settings.slateSize));

  useEffect(() => setSizeText(String(settings.slateSize)), [settings.slateSize]);

  // Current ESPN lines — shown live until the Monday lock.
  useEffect(() => {
    let cancelled = false;
    setEspn({});
    fetchWeekScoreboard(season, week).then((r) => {
      if (!cancelled) setEspn(r);
    });
    return () => {
      cancelled = true;
    };
  }, [season, week]);

  useEffect(() => {
    const next = new Map<string, DraftGame>();
    for (const g of slate?.games ?? []) {
      next.set(g.gameId, { storedSpread: g.homeSpread, isTiebreaker: g.isTiebreaker });
    }
    setDraft(next);
    setError(null);
  }, [slate, week]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of week.games) map.set(g.id, g);
    return map;
  }, [week]);

  const ats = settings.pickType === 'ats';
  const published = slate?.published ?? false;
  const weekStarted = week.games.some((g) => new Date(g.date).getTime() <= Date.now());
  const firstKick = week.games.length
    ? week.games.reduce((min, g) => (g.date < min ? g.date : min), week.games[0].date)
    : null;
  const lockAt = firstKick ? spreadLockTime(firstKick) : null;
  const linesLocked = !!slate?.spreadsLockedAt || (!!lockAt && Date.now() >= lockAt.getTime());
  const lockLabel = lockAt
    ? lockAt.toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';

  /** Best-known line for a game: locked slate value, else live ESPN. */
  const lineFor = (gameId: string): number | null => {
    if (linesLocked) return draft.get(gameId)?.storedSpread ?? null;
    return espn[gameId]?.odds?.spread ?? draft.get(gameId)?.storedSpread ?? null;
  };

  const selected = [...draft.keys()]
    .map((id) => gamesById.get(id))
    .filter((g): g is Game => !!g)
    .sort((a, b) => a.date.localeCompare(b.date));

  const candidates = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return week.games
      .filter((g) => g.home && g.away && !draft.has(g.id))
      .filter(
        (g) =>
          !q ||
          g.home!.school.toLowerCase().includes(q) ||
          g.away!.school.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Ranked matchups first — those are the slate candidates.
        const aRank = Math.min(a.home!.rank ?? 99, a.away!.rank ?? 99);
        const bRank = Math.min(b.home!.rank ?? 99, b.away!.rank ?? 99);
        return aRank - bRank || a.date.localeCompare(b.date);
      });
  }, [week, draft, filter]);

  const toggleGame = (gameId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.set(gameId, {
          storedSpread: espn[gameId]?.odds?.spread ?? null,
          isTiebreaker: false,
        });
      }
      return next;
    });
  };

  const setTiebreaker = (gameId: string) => {
    setDraft((prev) => {
      const next = new Map(prev);
      for (const [id, g] of next) next.set(id, { ...g, isTiebreaker: id === gameId });
      return next;
    });
  };

  const buildSlate = (publish: boolean): WeekSlate | null => {
    const games: SlateGame[] = [];
    for (const [gameId, d] of draft) {
      // Until the Monday lock, saving refreshes each game to ESPN's current
      // line; after the lock the stored number is the number.
      const live = espn[gameId]?.odds?.spread;
      const homeSpread = ats
        ? linesLocked
          ? (d.storedSpread ?? live ?? 0)
          : (live ?? d.storedSpread ?? 0)
        : 0;
      games.push({ gameId, homeSpread, isTiebreaker: d.isTiebreaker });
    }
    if (publish) {
      if (games.length === 0) {
        setError('Add at least one game to the slate.');
        return null;
      }
      if (!games.some((g) => g.isTiebreaker)) {
        setError('Mark one game as the GameDay tiebreaker.');
        return null;
      }
    }
    setError(null);
    return {
      season,
      seasonType: week.seasonType,
      week: week.week,
      games,
      pickType: settings.pickType,
      published: publish,
      spreadsLockedAt: slate?.spreadsLockedAt ?? null,
      updatedAt: new Date().toISOString(),
    };
  };

  const saveDraft = () => {
    const s = buildSlate(false);
    if (s) onSave(s);
  };

  const publish = () => {
    const s = buildSlate(true);
    if (s) onSave(s);
  };

  const unpublish = () => {
    if (!slate || weekStarted) return;
    Alert.alert('Unpublish slate?', 'Unpublish the slate so you can change the games?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unpublish',
        style: 'destructive',
        onPress: () => onSave({ ...slate, published: false, updatedAt: new Date().toISOString() }),
      },
    ]);
  };

  const commitSize = () => {
    const n = parseInt(sizeText, 10);
    if (Number.isFinite(n) && n >= 1) {
      onSaveSettings({ ...settings, slateSize: Math.min(n, 40) });
    } else {
      setSizeText(String(settings.slateSize));
    }
  };

  const countLabel =
    settings.slateSize > 0 && draft.size !== settings.slateSize
      ? `${draft.size} games (target ${settings.slateSize})`
      : `${draft.size} games`;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Pool settings</Text>
        <View style={styles.settingsRow}>
          <Pressable
            style={[styles.chip, settings.pickType === 'ats' && styles.chipActive]}
            onPress={() => onSaveSettings({ ...settings, pickType: 'ats' })}
          >
            <Text style={[styles.chipText, settings.pickType === 'ats' && styles.chipTextActive]}>
              Against the spread
            </Text>
          </Pressable>
          <Pressable
            style={[styles.chip, settings.pickType === 'su' && styles.chipActive]}
            onPress={() => onSaveSettings({ ...settings, pickType: 'su' })}
          >
            <Text style={[styles.chipText, settings.pickType === 'su' && styles.chipTextActive]}>
              Straight up
            </Text>
          </Pressable>
          <View style={styles.sizeField}>
            <Text style={styles.sizeLabel}>Games/week</Text>
            <TextInput
              style={styles.sizeInput}
              keyboardType="number-pad"
              value={sizeText}
              onChangeText={setSizeText}
              onBlur={commitSize}
              onSubmitEditing={commitSize}
            />
          </View>
        </View>
        <Text style={styles.note}>
          Pick style applies to new slates; the games-per-week number is just your target —
          add as many games as you want.
        </Text>
        {inviteCode && (
          <Text style={styles.invite}>
            Invite code: <Text style={styles.inviteCode}>{inviteCode}</Text> — share it so
            people can join the pool.
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.statusTop}>
          <Text style={styles.cardTitle}>
            {week.label} slate · {countLabel}
          </Text>
          <View style={styles.badges}>
            <Text style={[styles.badge, published ? styles.badgeOn : styles.badgeOff]}>
              {published ? 'Published' : 'Draft'}
            </Text>
            {ats && (
              <Text style={[styles.badge, linesLocked ? styles.badgeOn : styles.badgeOff]}>
                {linesLocked ? 'Lines locked' : `Lines float until ${lockLabel}`}
              </Text>
            )}
          </View>
        </View>
        <Text style={styles.note}>
          {ats
            ? `Spreads come straight from ESPN — nobody edits them. They move with the market until Monday of game week (${lockLabel}), then freeze at that number for grading. Games with no posted line play as PK unless one appears before the lock.`
            : 'Straight-up pool — players just pick winners, no spreads.'}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
        <View style={styles.actions}>
          {!published && (
            <>
              <Pressable
                style={[styles.ghostBtn, draft.size === 0 && styles.btnDisabled]}
                disabled={draft.size === 0}
                onPress={saveDraft}
              >
                <Text style={styles.ghostBtnText}>Save draft</Text>
              </Pressable>
              <Pressable
                style={[styles.submitBtn, draft.size === 0 && styles.btnDisabled]}
                disabled={draft.size === 0}
                onPress={publish}
              >
                <Text style={styles.submitBtnText}>Publish slate</Text>
              </Pressable>
            </>
          )}
          {published && !weekStarted && (
            <Pressable style={styles.ghostBtn} onPress={unpublish}>
              <Text style={styles.ghostBtnText}>Unpublish to edit games</Text>
            </Pressable>
          )}
        </View>
      </View>

      {selected.length > 0 && (
        <View>
          <Text style={styles.dayHeader}>Slate</Text>
          <View style={styles.card}>
            {selected.map((game) => {
              const d = draft.get(game.id)!;
              const line = lineFor(game.id);
              return (
                <View key={game.id} style={styles.slateRow}>
                  <View style={styles.slateRowMain}>
                    <Text style={styles.matchup}>{shortMatchup(game)}</Text>
                    <Text style={styles.time}>{kickoffLabel(game)}</Text>
                  </View>
                  <View style={styles.slateRowControls}>
                    {ats && (
                      <Text style={styles.line}>
                        {line != null
                          ? `${game.home?.abbrev ?? 'Home'} ${formatSpread(line)} · ${linesLocked ? 'locked' : 'live'}`
                          : 'No line yet · plays as PK if none by lock'}
                      </Text>
                    )}
                    <Pressable
                      style={[styles.tbChip, d.isTiebreaker && styles.tbChipOn]}
                      disabled={published}
                      onPress={() => setTiebreaker(game.id)}
                    >
                      <Text style={[styles.tbChipText, d.isTiebreaker && styles.tbChipTextOn]}>
                        GameDay TB
                      </Text>
                    </Pressable>
                    {!published && (
                      <Pressable style={styles.remove} onPress={() => toggleGame(game.id)}>
                        <Text style={styles.removeText}>✕</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {!published && (
        <View>
          <Text style={styles.dayHeader}>Add games</Text>
          <TextInput
            style={styles.search}
            placeholder="Search teams…"
            placeholderTextColor={colors.textDim}
            value={filter}
            onChangeText={setFilter}
          />
          <View style={styles.card}>
            {candidates.map((game) => (
              <Pressable key={game.id} style={styles.candidate} onPress={() => toggleGame(game.id)}>
                <Text style={styles.candidateAdd}>＋</Text>
                <View style={styles.candidateMain}>
                  <Text style={styles.candidateMatchup} numberOfLines={2}>
                    {game.away?.rank != null ? `#${game.away.rank} ` : ''}
                    {game.away?.school}
                    {game.neutralSite ? ' vs ' : ' at '}
                    {game.home?.rank != null ? `#${game.home.rank} ` : ''}
                    {game.home?.school}
                  </Text>
                  <Text style={styles.time}>
                    {kickoffLabel(game)}
                    {ats && espn[game.id]?.odds?.spread != null
                      ? ` · ${espn[game.id]!.odds!.details ?? formatSpread(espn[game.id]!.odds!.spread!)}`
                      : ''}
                  </Text>
                </View>
              </Pressable>
            ))}
            <Text style={styles.more}>
              {candidates.length} {candidates.length === 1 ? 'game' : 'games'} this week
              {filter.trim() ? ' matching your search' : ''} · ranked matchups first
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.navy,
    borderColor: colors.navy,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
  },
  chipTextActive: {
    color: '#fff',
  },
  sizeField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sizeLabel: {
    fontSize: 13,
    color: colors.textDim,
  },
  sizeInput: {
    width: 56,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
  },
  note: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 8,
  },
  invite: {
    fontSize: 13,
    color: colors.text,
    marginTop: 8,
  },
  inviteCode: {
    fontWeight: '800',
  },
  statusTop: {
    gap: 6,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    fontSize: 11,
    fontWeight: '800',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  badgeOn: {
    backgroundColor: colors.greenSoft,
    color: colors.green,
  },
  badgeOff: {
    backgroundColor: colors.amberSoft,
    color: colors.amber,
  },
  error: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.red,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  submitBtn: {
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  dayHeader: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textDim,
    paddingBottom: 8,
  },
  slateRow: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    gap: 6,
  },
  slateRowMain: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  matchup: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
  },
  time: {
    fontSize: 12,
    color: colors.textDim,
  },
  slateRowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  line: {
    fontSize: 12,
    color: colors.textDim,
    flexShrink: 1,
  },
  tbChip: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tbChipOn: {
    borderColor: colors.amber,
    backgroundColor: colors.amberSoft,
  },
  tbChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textDim,
  },
  tbChipTextOn: {
    color: colors.amber,
  },
  remove: {
    marginLeft: 'auto',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: {
    fontSize: 13,
    color: colors.textDim,
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
    marginBottom: 10,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  candidateAdd: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.green,
  },
  candidateMain: {
    flex: 1,
  },
  candidateMatchup: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  more: {
    fontSize: 12,
    color: colors.textDim,
    textAlign: 'center',
    paddingTop: 10,
  },
});
