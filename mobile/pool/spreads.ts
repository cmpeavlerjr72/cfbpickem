// Spread lock rule — mirrors web/src/pool/spreads.ts (see CLAUDE.md parity
// rule). Lines float with the market (ESPN) until Monday 12:00 AM ET of game
// week, then freeze. "Monday 00:00 ET" uses a fixed -5h offset so every
// client and the lock-spreads Edge Function agree byte-for-byte.

const ET_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The instant spreads lock for a week whose first kickoff is `firstKickIso`. */
export function spreadLockTime(firstKickIso: string): Date {
  const shifted = new Date(new Date(firstKickIso).getTime() - ET_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const mondayMidnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - daysSinceMonday,
  );
  return new Date(mondayMidnight + ET_OFFSET_MS);
}

export function spreadsAreLocked(spreadsLockedAt: string | null, firstKickIso: string | null): boolean {
  if (spreadsLockedAt) return true;
  if (!firstKickIso) return false;
  return Date.now() >= spreadLockTime(firstKickIso).getTime();
}
