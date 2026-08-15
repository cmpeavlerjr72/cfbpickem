// Pool persistence behind one interface. SupabasePoolStore is the real
// multi-user backend; LocalPoolStore remains as the offline/dev fallback
// when web/.env.local has no Supabase credentials.

import type { PoolEntry, PoolProfile, PoolSettings, WeekSlate } from './types';
import { DEFAULT_SETTINGS } from './types';
import { supabase } from './supabase';

export interface PoolStore {
  getProfile(): Promise<PoolProfile | null>;
  saveProfile(profile: PoolProfile): Promise<void>;

  getSettings(): Promise<PoolSettings>;
  saveSettings(settings: PoolSettings): Promise<void>;

  getSlate(season: number, seasonType: number, week: number): Promise<WeekSlate | null>;
  saveSlate(slate: WeekSlate): Promise<void>;

  /** All entries for a week (every player in the pool). */
  getEntries(season: number, seasonType: number, week: number): Promise<PoolEntry[]>;
  saveEntry(season: number, seasonType: number, week: number, entry: PoolEntry): Promise<void>;

  /** Everyone in the pool, whether or not they've entered picks yet. */
  getMembers(): Promise<PoolProfile[]>;
}

const profileKey = 'cfb-pickem:pool:profile';
const settingsKey = 'cfb-pickem:pool:settings';
const slateKey = (season: number, seasonType: number, week: number) =>
  `cfb-pickem:pool:slate:${season}:${seasonType}:${week}`;
const entriesKey = (season: number, seasonType: number, week: number) =>
  `cfb-pickem:pool:entries:${season}:${seasonType}:${week}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full — data just won't persist
  }
}

class LocalPoolStore implements PoolStore {
  async getProfile(): Promise<PoolProfile | null> {
    return readJson<PoolProfile>(profileKey);
  }

  async saveProfile(profile: PoolProfile): Promise<void> {
    writeJson(profileKey, profile);
  }

  async getSettings(): Promise<PoolSettings> {
    return readJson<PoolSettings>(settingsKey) ?? DEFAULT_SETTINGS;
  }

  async saveSettings(settings: PoolSettings): Promise<void> {
    writeJson(settingsKey, settings);
  }

  async getSlate(season: number, seasonType: number, week: number): Promise<WeekSlate | null> {
    return readJson<WeekSlate>(slateKey(season, seasonType, week));
  }

  async saveSlate(slate: WeekSlate): Promise<void> {
    writeJson(slateKey(slate.season, slate.seasonType, slate.week), slate);
  }

  async getEntries(season: number, seasonType: number, week: number): Promise<PoolEntry[]> {
    const map = readJson<Record<string, PoolEntry>>(entriesKey(season, seasonType, week));
    return map ? Object.values(map) : [];
  }

  async saveEntry(
    season: number,
    seasonType: number,
    week: number,
    entry: PoolEntry,
  ): Promise<void> {
    const key = entriesKey(season, seasonType, week);
    const map = readJson<Record<string, PoolEntry>>(key) ?? {};
    map[entry.playerId] = entry;
    writeJson(key, map);
  }

  async getMembers(): Promise<PoolProfile[]> {
    const profile = await this.getProfile();
    return profile ? [profile] : [];
  }
}

export const localPoolStore: PoolStore = new LocalPoolStore();

export function newPlayerId(): string {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Supabase-backed store. One instance per signed-in member; AuthGate resolves
// the session/pool and constructs it. Row shapes live in the migration
// (supabase/migrations/*_pool_schema.sql).

interface SlateRow {
  games: WeekSlate['games'];
  pick_type: string;
  published: boolean;
  spreads_locked_at: string | null;
  updated_at: string;
}

interface WeekEntryRow {
  player_id: string;
  player_name: string;
  picks: PoolEntry['picks'] | null;
  tiebreaker: PoolEntry['tiebreaker'];
  updated_at: string;
}

export class SupabasePoolStore implements PoolStore {
  readonly poolId: string;
  private profile: PoolProfile;

  constructor(poolId: string, profile: PoolProfile) {
    this.poolId = poolId;
    this.profile = profile;
  }

  private get db() {
    if (!supabase) throw new Error('Supabase is not configured');
    return supabase;
  }

  async getProfile(): Promise<PoolProfile | null> {
    return this.profile;
  }

  async saveProfile(profile: PoolProfile): Promise<void> {
    this.profile = profile;
    const { error } = await this.db
      .from('profiles')
      .update({ display_name: profile.playerName })
      .eq('id', profile.playerId);
    if (error) throw new Error(error.message);
  }

  async getSettings(): Promise<PoolSettings> {
    const { data, error } = await this.db
      .from('pools')
      .select('name, slate_size, push_points, pick_type')
      .eq('id', this.poolId)
      .single();
    if (error || !data) return DEFAULT_SETTINGS;
    return {
      name: data.name,
      slateSize: data.slate_size,
      pushPoints: Number(data.push_points),
      pickType: data.pick_type === 'su' ? 'su' : 'ats',
    };
  }

  async saveSettings(settings: PoolSettings): Promise<void> {
    const { error } = await this.db
      .from('pools')
      .update({
        name: settings.name,
        slate_size: settings.slateSize,
        push_points: settings.pushPoints,
        pick_type: settings.pickType,
      })
      .eq('id', this.poolId);
    if (error) throw new Error(error.message);
  }

  async getSlate(season: number, seasonType: number, week: number): Promise<WeekSlate | null> {
    const { data, error } = await this.db
      .from('slates')
      .select('games, pick_type, published, spreads_locked_at, updated_at')
      .eq('pool_id', this.poolId)
      .eq('season', season)
      .eq('season_type', seasonType)
      .eq('week', week)
      .maybeSingle<SlateRow>();
    if (error || !data) return null;
    return {
      season,
      seasonType,
      week,
      games: data.games ?? [],
      pickType: data.pick_type === 'su' ? 'su' : 'ats',
      published: data.published,
      spreadsLockedAt: data.spreads_locked_at,
      updatedAt: data.updated_at,
    };
  }

  async saveSlate(slate: WeekSlate): Promise<void> {
    const { error } = await this.db.from('slates').upsert(
      {
        pool_id: this.poolId,
        season: slate.season,
        season_type: slate.seasonType,
        week: slate.week,
        games: slate.games,
        pick_type: slate.pickType ?? 'ats',
        published: slate.published,
        spreads_locked_at: slate.spreadsLockedAt,
      },
      { onConflict: 'pool_id,season,season_type,week' },
    );
    if (error) throw new Error(error.message);
  }

  async getEntries(season: number, seasonType: number, week: number): Promise<PoolEntry[]> {
    const { data, error } = await this.db.rpc('week_entries', {
      p_pool: this.poolId,
      p_season: season,
      p_season_type: seasonType,
      p_week: week,
    });
    if (error || !data) return [];
    return (data as WeekEntryRow[]).map((row) => ({
      playerId: row.player_id,
      playerName: row.player_name,
      picks: row.picks ?? {},
      tiebreaker: row.tiebreaker,
      updatedAt: row.updated_at,
    }));
  }

  async saveEntry(
    season: number,
    seasonType: number,
    week: number,
    entry: PoolEntry,
  ): Promise<void> {
    const { error } = await this.db.from('entries').upsert(
      {
        pool_id: this.poolId,
        season,
        season_type: seasonType,
        week,
        player_id: entry.playerId,
        picks: entry.picks,
        tiebreaker: entry.tiebreaker,
      },
      { onConflict: 'pool_id,season,season_type,week,player_id' },
    );
    if (error) throw new Error(error.message);
  }

  async getMembers(): Promise<PoolProfile[]> {
    const { data, error } = await this.db
      .from('pool_members')
      .select('player_id, is_commissioner, profiles(display_name)')
      .eq('pool_id', this.poolId);
    if (error || !data) return [];
    return data.map((row) => ({
      playerId: row.player_id,
      playerName:
        (row.profiles as unknown as { display_name: string } | null)?.display_name ?? 'Player',
      isCommissioner: row.is_commissioner,
    }));
  }
}
