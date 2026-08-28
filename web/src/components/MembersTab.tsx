// Commissioner-only: the league roster — who's in, the email they signed up
// with, and who has paid their dues. The emails come from the `league_roster`
// RPC, which the DATABASE refuses to anyone who isn't this league's
// commissioner (supabase/migrations/20260828180000_league_dues.sql); this
// component is a view of that, never the security boundary. Nothing here is
// logged, copied out or sent anywhere.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoolStore } from '../pool/store';
import type { RosterMember } from '../pool/types';

/** Transient per-row feedback for the instant-save checkbox. */
type RowState = 'saving' | 'saved';

interface MembersTabProps {
  store: PoolStore;
  currentPlayerId: string;
}

export function MembersTab({ store, currentPlayerId }: MembersTabProps) {
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    store.getRoster().then(
      (r) => {
        if (!cancelled) {
          setRoster(r);
          setLoadError(null);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setRoster([]);
          setLoadError(err instanceof Error ? err.message : 'Could not load the roster.');
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  const clearRowLater = useCallback((playerId: string) => {
    timers.current.push(
      window.setTimeout(() => {
        setRowState((s) => {
          if (s[playerId] !== 'saved') return s;
          const next = { ...s };
          delete next[playerId];
          return next;
        });
      }, 2000),
    );
  }, []);

  // Optimistic: tick lands immediately, reverts if the write is refused.
  const toggle = useCallback(
    async (member: RosterMember, paid: boolean) => {
      setSaveError(null);
      setRoster((prev) =>
        prev ? prev.map((m) => (m.playerId === member.playerId ? { ...m, duesPaid: paid } : m)) : prev,
      );
      setRowState((s) => ({ ...s, [member.playerId]: 'saving' }));
      try {
        await store.setDuesPaid(member.playerId, paid);
        setRowState((s) => ({ ...s, [member.playerId]: 'saved' }));
        clearRowLater(member.playerId);
      } catch (err) {
        setRoster((prev) =>
          prev
            ? prev.map((m) => (m.playerId === member.playerId ? { ...m, duesPaid: !paid } : m))
            : prev,
        );
        setRowState((s) => {
          const next = { ...s };
          delete next[member.playerId];
          return next;
        });
        setSaveError(err instanceof Error ? err.message : 'Couldn’t save that change.');
      }
    },
    [store, clearRowLater],
  );

  if (!roster) return <p className="results-loading">Loading roster…</p>;

  const paid = roster.filter((m) => m.duesPaid).length;
  const allPaid = roster.length > 0 && paid === roster.length;

  return (
    <div className="members">
      <div className="slate-status-card">
        <div className="slate-status-top">
          <h2 className="slate-status-title">Members &amp; dues</h2>
          <span className={`slate-badge ${allPaid ? 'published' : 'draft'}`}>
            {paid} of {roster.length} paid
          </span>
        </div>
        <p className="slate-status-note">
          Only you see this page. Emails come straight from each member’s account and the
          database hands them to this league’s commissioner alone — nobody else can query
          them. Tick a box the moment someone pays; it saves itself.
        </p>
        {loadError && <p className="slate-error">Couldn’t load the roster: {loadError}</p>}
        {saveError && <p className="slate-error">{saveError}</p>}
      </div>

      {roster.length === 0 && !loadError ? (
        <div className="results-empty">
          <div className="results-empty-title">No members yet</div>
          <p>Share your invite code from the Slate tab and they’ll show up here.</p>
        </div>
      ) : (
        <table className="board-table members-table">
          <thead>
            <tr>
              <th>Member</th>
              <th className="num">Dues paid</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((m) => {
              const state = rowState[m.playerId];
              return (
                <tr key={m.playerId} className={m.playerId === currentPlayerId ? 'me' : ''}>
                  <td>
                    <span className="member-name">
                      {m.playerName}
                      {m.isCommissioner && <span className="member-tag">Commish</span>}
                    </span>
                    <span className="member-email">{m.email ?? 'no account email'}</span>
                  </td>
                  <td className="num">
                    <label className="dues-check">
                      <input
                        type="checkbox"
                        checked={m.duesPaid}
                        onChange={(e) => toggle(m, e.target.checked)}
                      />
                      <span className={`dues-flag${state === 'saved' ? ' saved' : ''}`}>
                        {state === 'saving'
                          ? 'Saving…'
                          : state === 'saved'
                            ? 'Saved ✓'
                            : m.duesPaid
                              ? 'Paid'
                              : 'Unpaid'}
                      </span>
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
