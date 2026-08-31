// The account dashboard: every league you're in (tap to enter), join by
// invite code, start a new league, and account settings (display name,
// password, sign out, delete account). Mirrored by
// mobile/components/Dashboard.tsx (see CLAUDE.md parity rule).

import { useState } from 'react';
import { supabase } from '../pool/supabase';
import type { AccountContext } from './AuthGate';

interface DashboardProps {
  account: AccountContext;
  onSelect: (poolId: string) => void;
}

export function Dashboard({ account, onSelect }: DashboardProps) {
  const [joinCode, setJoinCode] = useState('');
  const [newName, setNewName] = useState('');
  const [displayName, setDisplayName] = useState(account.displayName);
  const [realName, setRealName] = useState(account.realName ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const joinLeague = () =>
    run(async () => {
      const { data, error: err } = await supabase!.rpc('join_pool', { p_code: joinCode.trim() });
      if (err) throw new Error(err.message.includes('invalid') ? 'Invalid invite code.' : err.message);
      await account.refresh();
      setJoinCode('');
      if (data) onSelect(data as string);
      return null;
    });

  const createLeague = () =>
    run(async () => {
      const { data, error: err } = await supabase!.rpc('create_pool', { p_name: newName.trim() });
      if (err) throw new Error(err.message);
      await account.refresh();
      setNewName('');
      if (data) onSelect(data as string);
      return null;
    });

  const saveName = () =>
    run(async () => {
      const name = displayName.trim();
      if (!name) throw new Error('Display name can’t be empty.');
      const { error: err } = await supabase!
        .from('profiles')
        .update({ display_name: name })
        .eq('id', account.userId);
      if (err) throw new Error(err.message);
      await account.refresh();
      return 'Display name updated.';
    });

  const saveRealName = () =>
    run(async () => {
      const name = realName.trim();
      const { error: err } = await supabase!
        .from('profiles')
        .update({ real_name: name || null })
        .eq('id', account.userId);
      if (err) throw new Error(err.message);
      await account.refresh();
      return name ? 'Real name updated.' : 'Real name cleared.';
    });

  const savePassword = () =>
    run(async () => {
      const { error: err } = await supabase!.auth.updateUser({ password: newPassword });
      if (err) throw new Error(err.message);
      setNewPassword('');
      return 'Password updated.';
    });

  // Apple Guideline 5.1.1(v): account deletion has to be doable in-app. The
  // delete_account RPC tidies up leagues (promoting a new commissioner if
  // needed) and deletes the auth user, which cascades profile/picks away.
  const deleteAccount = () =>
    run(async () => {
      const { error: err } = await supabase!.rpc('delete_account');
      if (err) throw new Error(err.message);
      setConfirmDelete(false);
      // account.signOut() calls supabase.auth.signOut(); the server side of
      // that can fail now that the user is gone, but it clears the local
      // session regardless and AuthGate drops back to the sign-in screen.
      account.signOut();
      return null;
    });

  return (
    <div className="dash-screen">
      <div className="dash-inner">
        <header className="dash-header">
          <span className="dash-logo">🏈</span>
          <div>
            <h1 className="dash-title">Your leagues</h1>
            <p className="dash-sub">Signed in as {account.displayName}</p>
          </div>
        </header>

        {error && <p className="auth-error">{error}</p>}
        {notice && <p className="dash-notice">{notice}</p>}

        <section className="dash-card">
          {account.memberships.length === 0 ? (
            <p className="dash-empty">
              You’re not in a league yet — join one with an invite code below, or start your
              own.
            </p>
          ) : (
            <div className="dash-leagues">
              {account.memberships.map((m) => (
                <button
                  key={m.poolId}
                  type="button"
                  className="dash-league"
                  onClick={() => onSelect(m.poolId)}
                >
                  <span className="dash-league-name">{m.poolName}</span>
                  <span className="dash-league-meta">
                    {m.isCommissioner ? 'Commissioner' : 'Player'}
                    {m.inviteCode ? ` · invite ${m.inviteCode}` : ''}
                  </span>
                  <span className="dash-league-go">›</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">Join a league</h2>
          <div className="dash-row">
            <input
              className="setup-input dash-input invite-input"
              placeholder="ABC123"
              value={joinCode}
              maxLength={6}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && joinCode.trim().length >= 6 && joinLeague()}
            />
            <button
              type="button"
              className="submit-btn"
              disabled={joinCode.trim().length < 6 || busy}
              onClick={joinLeague}
            >
              Join
            </button>
          </div>
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">Start a new league</h2>
          <div className="dash-row">
            <input
              className="setup-input dash-input"
              placeholder="League name"
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createLeague()}
            />
            <button type="button" className="submit-btn" disabled={busy} onClick={createLeague}>
              Create
            </button>
          </div>
          <p className="dash-hint">You’ll be the commissioner: you set the slate each week.</p>
        </section>

        <section className="dash-card">
          <h2 className="dash-card-title">Account</h2>
          <div className="dash-row">
            <input
              className="setup-input dash-input"
              placeholder="Display name"
              value={displayName}
              maxLength={40}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || !displayName.trim() || displayName.trim() === account.displayName}
              onClick={saveName}
            >
              Save
            </button>
          </div>
          <p className="dash-hint">Your name on every league’s scoreboard and standings.</p>
          <div className="dash-row">
            <input
              className="setup-input dash-input"
              placeholder="Real name (shown on leaderboards)"
              value={realName}
              maxLength={60}
              onChange={(e) => setRealName(e.target.value)}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || realName.trim() === (account.realName ?? '')}
              onClick={saveRealName}
            >
              Save
            </button>
          </div>
          <p className="dash-hint">
            Optional — when set, leaderboards show this instead of your display name.
          </p>
          <div className="dash-row">
            <input
              className="setup-input dash-input"
              type="password"
              autoComplete="new-password"
              placeholder="New password (6+ characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={busy || newPassword.length < 6}
              onClick={savePassword}
            >
              Update
            </button>
          </div>
          <button type="button" className="auth-signout" onClick={account.signOut}>
            Sign out
          </button>
        </section>

        <section className="dash-card dash-danger">
          <h2 className="dash-card-title">Delete account</h2>
          {confirmDelete ? (
            <>
              <p className="dash-hint">
                This permanently deletes your account, your picks, and removes you from your
                leagues. If you’re the only commissioner of a league, the longest-standing
                member becomes commissioner.
              </p>
              <div className="dash-row">
                <button
                  type="button"
                  className="danger-btn"
                  disabled={busy}
                  onClick={deleteAccount}
                >
                  Yes, delete my account
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="dash-hint">
                Permanently removes your account, your picks, and your league memberships.
                This can’t be undone.
              </p>
              <button
                type="button"
                className="danger-link"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                Delete account
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
