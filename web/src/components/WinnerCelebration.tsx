/**
 * A one-time, deliberately silly "WEEKLY WINNER" celebration — owner request
 * 2026-08-29, hardcoded to a single league. Every other pool renders nothing,
 * ever; this is a league in-joke, not a product feature, so it must never
 * grow into a generic pool setting without the owner asking for that.
 *
 * Two things live here:
 *   1. The one-time full-screen overlay (unchanged since the first cut).
 *   2. A persistent "badge" — a small docked dancer that hangs around in the
 *      corner from the win until the next week's slate kicks off (owner
 *      follow-up, 2026-08-29). It renders purely off a localStorage record so
 *      it survives the app's own week-selector rolling forward past the win.
 *
 * Trigger logic is NOT reimplemented here — as of 2026-08-30 that's true by
 * construction: the mount-time sweep calls `pool/scoredWeeks.loadScoredWeeks`,
 * the very function the Standings tab renders from, so neither can crown a
 * "winner" the Standings tab disagrees with. The live current-week path still
 * calls the same `isWeekComplete` / `scoreWeek` pair with the loader's guards
 * (published, non-empty slate, at least one entry) mirrored inline.
 *
 * The sweep exists because detection used to look ONLY at the currently loaded
 * week, while the app's week selector auto-advances ~12h after a week's last
 * kickoff — so the winner who opened the app the next morning was already on
 * next week and never saw a thing (bug, 2026-08-30).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SeasonData, WeekData } from '../types';
import type { WeekResults } from '../results';
import type { PoolEntry, PoolSettings, WeekSlate } from '../pool/types';
import type { PoolStore } from '../pool/store';
import type { ScoredWeek } from '../pool/scoring';
import { isWeekComplete, scoreWeek } from '../pool/scoring';
import { loadScoredWeeks } from '../pool/scoredWeeks';
import { DEGENERATE_NATION_POOL_ID } from '../pool/degenerate';

const CONFETTI_COUNT = 12;

function celebratedKey(poolId: string, slate: WeekSlate): string {
  return `cfb-pickem:celebrated:${poolId}:${slate.season}:${slate.seasonType}:${slate.week}`;
}

/** Storage is a convenience, never a dependency (house style — see InstallPrompt.tsx). */
function alreadyCelebrated(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false; // blocked storage — worst case this replays once
  }
}

function markCelebrated(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // blocked storage — nothing persists, but the celebration still shows this load
  }
}

// ---------------------------------------------------------------------------
// Persistent badge: from the win until the next week's first kickoff.

interface WinnerBadgeRecord {
  season: number;
  seasonType: number;
  week: number;
  playerId: string;
  /** ISO timestamp of when this record was first written for this win. */
  wonAtIso: string;
}

function badgeStorageKey(poolId: string): string {
  return `cfb-pickem:winnerBadge:${poolId}`;
}

function readBadgeRecord(poolId: string): WinnerBadgeRecord | null {
  try {
    const raw = localStorage.getItem(badgeStorageKey(poolId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WinnerBadgeRecord>;
    if (
      typeof parsed.season === 'number' &&
      typeof parsed.seasonType === 'number' &&
      typeof parsed.week === 'number' &&
      typeof parsed.playerId === 'string' &&
      typeof parsed.wonAtIso === 'string'
    ) {
      return parsed as WinnerBadgeRecord;
    }
    return null;
  } catch {
    return null;
  }
}

function writeBadgeRecord(poolId: string, record: WinnerBadgeRecord): void {
  try {
    localStorage.setItem(badgeStorageKey(poolId), JSON.stringify(record));
  } catch {
    // blocked storage — the badge just won't survive a reload this device
  }
}

function clearBadgeRecord(poolId: string): void {
  try {
    localStorage.removeItem(badgeStorageKey(poolId));
  } catch {
    // ignore
  }
}

/**
 * The badge record for a win, WITHOUT writing it — callers check the cutoff
 * first and then persist. The original win timestamp is preserved when the
 * stored record is already this same win, so the no-next-week 7-day fallback
 * doesn't keep sliding forward on every revisit.
 */
function winRecord(poolId: string, slate: WeekSlate, playerId: string): WinnerBadgeRecord {
  const existing = readBadgeRecord(poolId);
  const sameWin =
    existing &&
    existing.season === slate.season &&
    existing.seasonType === slate.seasonType &&
    existing.week === slate.week &&
    existing.playerId === playerId;
  return {
    season: slate.season,
    seasonType: slate.seasonType,
    week: slate.week,
    playerId,
    wonAtIso: sameWin ? existing.wonAtIso : new Date().toISOString(),
  };
}

const BADGE_FALLBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * "Next week's slate starts" is approximated as the earliest kickoff among
 * week+1's games in the bundled season data — this is fine even before the
 * commissioner has published that week's slate, since the schedule itself
 * (games.json) is fetched well ahead of publish. If there's no week+1 in the
 * bundled data (season over) or it has no games yet, fall back to a flat 7
 * days from the win so the badge still expires eventually.
 */
function badgeCutoff(record: WinnerBadgeRecord, weeks: WeekData[]): number {
  const idx = weeks.findIndex((w) => w.seasonType === record.seasonType && w.week === record.week);
  const nextWeek = idx >= 0 ? weeks[idx + 1] : undefined;
  const kicks = (nextWeek?.games ?? [])
    .map((g) => new Date(g.date).getTime())
    .filter((t) => Number.isFinite(t));
  if (kicks.length > 0) return Math.min(...kicks);
  return new Date(record.wonAtIso).getTime() + BADGE_FALLBACK_MS;
}

// ---------------------------------------------------------------------------
// Owner preview mode: ?celebrate=preview / ?celebrate=badge render the
// graphics unconditionally (any pool, winner or not) for whoever is signed
// in, purely so the owner can eyeball the artwork and iterate — never reads
// or writes the celebrated/badge storage, so it's safe to reload forever and
// safe to leave wired up in production permanently.
type PreviewMode = 'preview' | 'badge' | null;

function readPreviewMode(): PreviewMode {
  try {
    const v = new URLSearchParams(window.location.search).get('celebrate');
    return v === 'preview' || v === 'badge' ? v : null;
  } catch {
    return null;
  }
}

/** The most recent week that's fully in the books, or null if none is. */
function lastCompleteWeek(weeks: ScoredWeek[]): ScoredWeek | null {
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].complete) return weeks[i];
  }
  return null;
}

/** What the full-screen overlay says, whoever decided to show it. */
interface OverlayContent {
  name: string;
  record: string;
  weekLabel: string;
}

function recordText(score: { wins: number; losses: number; pushes: number }): string {
  return `${score.wins}–${score.losses}${score.pushes > 0 ? `–${score.pushes}` : ''}`;
}

interface WinnerCelebrationProps {
  /** PoolStore.poolId — null in offline/local mode, where there is no pool row to match. */
  poolId: string | null;
  week: WeekData;
  slate: WeekSlate | null;
  entries: PoolEntry[];
  results: WeekResults;
  settings: PoolSettings;
  currentPlayerId: string;
  /** Display name of the signed-in member — used for the ?celebrate=preview graphic. */
  currentPlayerName: string;
  /**
   * The full bundled season: `season.weeks` lets the persistent badge look up
   * "next week's first kickoff" for whatever week is in the STORED record —
   * which, after rollover, is no longer the currently-loaded `week`/`slate` —
   * and the whole thing feeds the mount-time sweep's loadScoredWeeks call.
   */
  season: SeasonData;
  /** Same store Standings reads from; the sweep loads past weeks through it. */
  store: PoolStore;
  /** So the badge can dock above the pick bar instead of overlapping it. */
  pickBarVisible: boolean;
}

export function WinnerCelebration({
  poolId,
  week,
  slate,
  entries,
  results,
  settings,
  currentPlayerId,
  currentPlayerName,
  season,
  store,
  pickBarVisible,
}: WinnerCelebrationProps) {
  const [previewMode] = useState<PreviewMode>(readPreviewMode);

  const eligiblePool = poolId === DEGENERATE_NATION_POOL_ID;

  // Mirrors StandingsTab's loadScoredWeeks guards exactly (published slate,
  // at least one game, at least one entry) before handing off to the same
  // scoring functions it uses.
  const myWin = useMemo(() => {
    if (!eligiblePool || !slate || !slate.published || slate.games.length === 0) return null;
    if (entries.length === 0) return null;
    if (!isWeekComplete(slate, results)) return null;
    const scored = scoreWeek(slate, entries, results, settings);
    const mine = scored.find((s) => s.entry.playerId === currentPlayerId);
    return mine && mine.rank === 1 ? mine : null;
  }, [eligiblePool, slate, entries, results, settings, currentPlayerId]);

  // ---- one-time overlay visibility ----
  // Two paths can raise the overlay (the live current-week detection and the
  // mount-time sweep), so the state records WHICH one owns it: the current-week
  // effect may only take DOWN its own overlay when the win stops applying —
  // otherwise a slate refetch would wipe a swept celebration off the screen.
  // The sweep never displaces one that's already up; a live win detected after
  // it does take over, since that's the fresher news and the swept week keeps
  // its corner badge either way.
  const [overlay, setOverlay] = useState<{ source: 'week' | 'sweep'; content: OverlayContent } | null>(
    null,
  );
  const [previewVisible, setPreviewVisible] = useState(previewMode === 'preview');
  /**
   * The celebrated key both paths have already resolved this mount. Together
   * with the localStorage flag it's what keeps them from double-firing: whoever
   * gets there first marks the key, and the other one bails on seeing it (the
   * ref covers the case where storage is blocked and the flag can't persist).
   */
  const decidedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previewMode) return; // preview modes never touch the celebrated flag
    const key = poolId && slate && myWin ? celebratedKey(poolId, slate) : null;
    if (!key) {
      setOverlay((cur) => (cur?.source === 'week' ? null : cur));
      return;
    }
    if (decidedKeyRef.current === key) return;
    decidedKeyRef.current = key;
    if (alreadyCelebrated(key)) return;
    // Set the flag immediately — before the reveal even renders — so a
    // reload mid-animation (or mid-dismiss) never replays it.
    markCelebrated(key);
    setOverlay({
      source: 'week',
      content: { name: myWin!.entry.playerName, record: recordText(myWin!), weekLabel: week.label },
    });
  }, [previewMode, poolId, slate, myWin, week.label]);

  // No auto-dismiss (owner feedback 2026-08-29): she loops until the ✕ is
  // pressed. The ✕ is the ONLY dismiss — a stray scrim tap can't burn the
  // once-per-week show by accident.

  // ---- persistent badge: load from storage + live-expire at the cutoff ----
  const [badge, setBadge] = useState<{ record: WinnerBadgeRecord; cutoff: number } | null>(null);

  const loadBadge = useCallback(() => {
    if (!poolId || poolId !== DEGENERATE_NATION_POOL_ID) {
      setBadge(null);
      return;
    }
    const record = readBadgeRecord(poolId);
    if (!record || record.playerId !== currentPlayerId) {
      setBadge(null);
      return;
    }
    const cutoff = badgeCutoff(record, season.weeks);
    if (Date.now() >= cutoff) {
      clearBadgeRecord(poolId);
      setBadge(null);
      return;
    }
    setBadge({ record, cutoff });
  }, [poolId, currentPlayerId, season.weeks]);

  useEffect(() => {
    if (previewMode) return; // preview modes never read/write the real badge record
    loadBadge();
  }, [previewMode, loadBadge]);

  // Whenever the viewing member is detected as this (complete) week's
  // winner — the first celebratory show, or any later revisit while that
  // winning week is still the one loaded — (re)write the persistent record
  // so the badge survives the app's own week rollover. The original win
  // timestamp is preserved across re-detections so the no-next-week 7-day
  // fallback doesn't keep sliding forward on every revisit.
  useEffect(() => {
    if (previewMode) return;
    if (!poolId || !myWin || !slate) return;
    writeBadgeRecord(poolId, winRecord(poolId, slate, currentPlayerId));
    loadBadge();
  }, [previewMode, poolId, myWin, slate, currentPlayerId, loadBadge]);

  // ---- mount-time sweep: the win the week selector already rolled past ----
  // Runs once per mount (App remounts per league), for the one eligible pool
  // only. Everything it can decide — is the week complete, who is rank 1 — it
  // decides with the SAME loader the Standings tab renders from.
  const sweptRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Re-armed on every mount because StrictMode tears the first one down.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previewMode) return; // preview modes never read/write real storage
    if (!poolId || poolId !== DEGENERATE_NATION_POOL_ID) return;
    if (sweptRef.current) return;
    sweptRef.current = true;
    loadScoredWeeks(season, settings, store, { onlyStartedWeeks: true })
      .then((scoredWeeks) => {
        // If the member left the league (or the app) while this was in flight,
        // stop: marking a week celebrated without showing it burns the reveal.
        if (!mountedRef.current) return;
        const lastComplete = lastCompleteWeek(scoredWeeks);
        if (!lastComplete) return;
        const mine = lastComplete.scores.find((s) => s.entry.playerId === currentPlayerId);
        if (!mine || mine.rank !== 1) return;
        const record = winRecord(poolId, lastComplete.slate, currentPlayerId);
        // Past the badge window (next week has kicked off) = stale news: no
        // badge, and no retroactive party either.
        if (Date.now() >= badgeCutoff(record, season.weeks)) return;
        writeBadgeRecord(poolId, record);
        loadBadge();
        const key = celebratedKey(poolId, lastComplete.slate);
        // Same guards as the current-week path, in the same order — whichever
        // path resolves this key first is the one that shows it.
        if (decidedKeyRef.current === key || alreadyCelebrated(key)) return;
        decidedKeyRef.current = key;
        markCelebrated(key);
        // Never displace an overlay the current-week path already raised.
        setOverlay(
          (cur) =>
            cur ?? {
              source: 'sweep',
              content: {
                name: mine.entry.playerName,
                record: recordText(mine),
                weekLabel: lastComplete.label,
              },
            },
        );
      })
      .catch(() => {
        // Best effort — a failed fetch just means no retroactive celebration.
      });
  }, [previewMode, poolId, season, settings, store, currentPlayerId, loadBadge]);

  // Live-expire right at the cutoff (not just "on next check") — a single
  // bounded timer (next week's kickoff or the 7-day fallback are always well
  // under a month out, so no setTimeout overflow risk), only while a badge
  // is actually active.
  useEffect(() => {
    if (!badge) return;
    const ms = badge.cutoff - Date.now();
    if (ms <= 0) {
      if (poolId) clearBadgeRecord(poolId);
      setBadge(null);
      return;
    }
    const timer = window.setTimeout(() => {
      if (poolId) clearBadgeRecord(poolId);
      setBadge(null);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [badge, poolId]);

  // ---- preview content (any pool, winner or not; own name only) ----
  const previewOverlayContent = useMemo(() => {
    if (previewMode !== 'preview') return null;
    if (slate && entries.length > 0) {
      const scored = scoreWeek(slate, entries, results, settings);
      const mine = scored.find((s) => s.entry.playerId === currentPlayerId);
      if (mine && (mine.wins > 0 || mine.losses > 0 || mine.pushes > 0)) {
        return {
          name: currentPlayerName,
          record: `${mine.wins}–${mine.losses}${mine.pushes > 0 ? `–${mine.pushes}` : ''}`,
          weekLabel: week.label,
        };
      }
    }
    return { name: currentPlayerName, record: '6–2', weekLabel: 'Week 1' };
  }, [previewMode, slate, entries, results, settings, currentPlayerId, currentPlayerName, week]);

  // ---- assemble what actually renders ----
  const overlayContent: OverlayContent | null =
    previewMode === 'preview'
      ? previewVisible
        ? previewOverlayContent
        : null
      : (overlay?.content ?? null);
  const showOverlay = overlayContent != null;
  const dismissOverlay = () => {
    if (previewMode === 'preview') setPreviewVisible(false);
    else setOverlay(null);
  };

  const showBadge = previewMode === 'badge' || badge != null;
  const badgeWeekNum = previewMode === 'badge' ? week.week : (badge?.record.week ?? week.week);

  if (!showOverlay && !showBadge) return null;

  return (
    <>
      {showOverlay && overlayContent && (
        <div
          className="celebrate-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Weekly winner celebration"
        >
          <div className="celebrate-confetti" aria-hidden="true">
            {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
              <span
                key={i}
                className={`celebrate-dot celebrate-dot-${i % 6}`}
                style={{
                  left: `${(i * 100) / CONFETTI_COUNT}%`,
                  animationDelay: `${(i % 5) * 0.4}s`,
                }}
              />
            ))}
          </div>

          <div className="celebrate-dancer-track" aria-hidden="true">
            <img src="/celebrate/dancer.png" alt="" className="celebrate-dancer" />
          </div>

          <div className="celebrate-banner">
            <div className="celebrate-title">WEEKLY WINNER 🏆</div>
            <div className="celebrate-name">{overlayContent.name}</div>
            <div className="celebrate-record">
              {overlayContent.record} · {overlayContent.weekLabel} champ
            </div>
          </div>

          <button
            type="button"
            className="celebrate-close"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              dismissOverlay();
            }}
          >
            &times;
          </button>
        </div>
      )}

      {showBadge && (
        <div
          className={`winner-badge${pickBarVisible ? ' winner-badge-clear-pickbar' : ''}`}
          aria-hidden="true"
        >
          <img src="/celebrate/dancer.png" alt="" className="winner-badge-dancer" />
          <span className="winner-badge-caption">Wk {badgeWeekNum} champ</span>
        </div>
      )}
    </>
  );
}
