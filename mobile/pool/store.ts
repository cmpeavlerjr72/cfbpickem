// Pool persistence — mirrors web/src/pool/store.ts (see CLAUDE.md parity
// rule). Mobile ships its Supabase config baked in, so unlike web there is
// no LocalPoolStore fallback: SupabasePoolStore is the only implementation.

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

  async getProfile(): Promise<PoolProfile | null> {
    return this.profile;
  }

  async saveProfile(profile: PoolProfile): Promise<void> {
    this.profile = profile;
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: profile.playerName })
      .eq('id', profile.playerId);
    if (error) throw new Error(error.message);
  }

  async getSettings(): Promise<PoolSettings> {
    const { data, error } = await supabase
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
    const { error } = await supabase
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
    const { data, error } = await supabase
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
    const { error } = await supabase.from('slates').upsert(
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
    const { data, error } = await supabase.rpc('week_entries', {
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
    const { error } = await supabase.from('entries').upsert(
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
    const { data, error } = await supabase
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
