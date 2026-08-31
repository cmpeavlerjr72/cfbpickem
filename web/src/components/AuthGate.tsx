// Sign-in gate for the Supabase backend: email + password (with a
// reset-email recovery flow) → display name (first visit) → the account
// context with EVERY league the player belongs to. League selection,
// joining, and creating live on the Dashboard; this gate only resolves who
// you are. Accounts from the old magic-link era have no password —
// "Forgot password?" sets one.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../pool/supabase';
import type { PoolMembership } from '../pool/types';

export interface AccountContext {
  userId: string;
  displayName: string;
  /** Optional "real name" for leaderboards; null when not set. */
  realName: string | null;
  memberships: PoolMembership[];
  /** Re-fetch profile + memberships (after a name change, join, or create). */
  refresh: () => Promise<void>;
  signOut: () => void;
}

type Phase = 'loading' | 'signedOut' | 'resetSent' | 'confirmSent' | 'needName' | 'ready';

interface MembershipRow {
  pool_id: string;
  is_commissioner: boolean;
  pools: { name: string; invite_code: string } | null;
}

export function AuthGate({ children }: { children: (ctx: AccountContext) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<AccountContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // True while the user arrived via a password-reset link; shows the
  // set-new-password form regardless of phase (the reset link also signs
  // them in, so resolveAccount may race past it otherwise).
  const [recovering, setRecovering] = useState(false);
  const recoveringRef = useRef(false);

  const signOut = useCallback(() => {
    supabase!.auth.signOut();
    setCtx(null);
    setPhase('signedOut');
  }, []);

  const resolveAccount = useCallback(
    async (s: Session) => {
      if (recoveringRef.current) return;
      const userId = s.user.id;
      const { data: prof } = await supabase!
        .from('profiles')
        .select('display_name, real_name')
        .eq('id', userId)
        .maybeSingle();
      if (!prof) {
        setPhase('needName');
        return;
      }
      const { data: rows } = await supabase!
        .from('pool_members')
        .select('pool_id, is_commissioner, pools(name, invite_code)')
        .eq('player_id', userId);
      const memberships: PoolMembership[] = ((rows ?? []) as unknown as MembershipRow[])
        .map((row) => ({
          poolId: row.pool_id,
          poolName: row.pools?.name ?? 'Pool',
          inviteCode: row.pools?.invite_code ?? '',
          isCommissioner: row.is_commissioner,
        }))
        .sort((a, b) => a.poolName.localeCompare(b.poolName));
      setCtx({
        userId,
        displayName: prof.display_name,
        realName: prof.real_name ?? null,
        memberships,
        refresh: async () => resolveAccount(s),
        signOut,
      });
      setPhase('ready');
    },
    [signOut],
  );

  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) resolveAccount(data.session);
      else setPhase('signedOut');
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') {
        recoveringRef.current = true;
        setRecovering(true);
      }
      if (event === 'SIGNED_IN' && s) resolveAccount(s);
      if (event === 'SIGNED_OUT') setPhase('signedOut');
    });
    return () => sub.subscription.unsubscribe();
  }, [resolveAccount]);

  if (recovering && session) {
    return (
      <Shell>
        <NewPasswordForm
          busy={busy}
          error={error}
          onSubmit={async (password) => {
            setBusy(true);
            setError(null);
            const { error: err } = await supabase!.auth.updateUser({ password });
            setBusy(false);
            if (err) setError(err.message);
            else {
              recoveringRef.current = false;
              setRecovering(false);
              resolveAccount(session);
            }
          }}
        />
      </Shell>
    );
  }

  if (phase === 'ready' && ctx) return <>{children(ctx)}</>;
  if (phase === 'loading') return null;

  return (
    <Shell>
      {phase === 'signedOut' && (
        <CredentialsForm
          busy={busy}
          error={error}
          onSignIn={async (email, password) => {
            setBusy(true);
            setError(null);
            const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
            setBusy(false);
            if (err) {
              setError(
                err.message.includes('Invalid login credentials')
                  ? 'Wrong email or password. If you used the old email-link sign-in, set a password with “Forgot password?”.'
                  : err.message,
              );
            }
          }}
          onSignUp={async (email, password) => {
            setBusy(true);
            setError(null);
            const { data, error: err } = await supabase!.auth.signUp({ email, password });
            setBusy(false);
            if (err) {
              setError(
                err.message.includes('already registered')
                  ? 'That email already has an account — sign in instead (or use “Forgot password?”).'
                  : err.message,
              );
            } else if (!data.session) {
              setPhase('confirmSent');
            }
          }}
          onForgot={async (email) => {
            setBusy(true);
            setError(null);
            const { error: err } = await supabase!.auth.resetPasswordForEmail(email, {
              redirectTo: window.location.origin,
            });
            setBusy(false);
            if (err) setError(err.message);
            else setPhase('resetSent');
          }}
        />
      )}
      {phase === 'resetSent' && (
        <>
          <h1 className="setup-title">Check your email</h1>
          <p className="setup-sub">
            We sent a password-reset link. Open it on this device, choose a new password,
            and you’ll land right back here signed in.
          </p>
          <button type="button" className="ghost-btn setup-btn" onClick={() => setPhase('signedOut')}>
            Back to sign in
          </button>
        </>
      )}
      {phase === 'confirmSent' && (
        <>
          <h1 className="setup-title">Confirm your email</h1>
          <p className="setup-sub">
            We sent a confirmation link to your email. Click it, then come back and sign in.
          </p>
          <button type="button" className="ghost-btn setup-btn" onClick={() => setPhase('signedOut')}>
            Back to sign in
          </button>
        </>
      )}
      {phase === 'needName' && session && (
        <NameForm
          busy={busy}
          error={error}
          onSubmit={async (name) => {
            setBusy(true);
            setError(null);
            const { error: err } = await supabase!
              .from('profiles')
              .upsert({ id: session.user.id, display_name: name });
            setBusy(false);
            if (err) setError(err.message);
            else resolveAccount(session);
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">🏈</div>
        {children}
      </div>
    </div>
  );
}

function CredentialsForm({
  busy,
  error,
  onSignIn,
  onSignUp,
  onForgot,
}: {
  busy: boolean;
  error: string | null;
  onSignIn: (email: string, password: string) => void;
  onSignUp: (email: string, password: string) => void;
  onForgot: (email: string) => void;
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailValid = /\S+@\S+\.\S+/.test(email);
  const valid = emailValid && password.length >= 6;
  const submit = () => {
    if (!valid || busy) return;
    if (mode === 'signin') onSignIn(email.trim(), password);
    else onSignUp(email.trim(), password);
  };
  return (
    <>
      <h1 className="setup-title">Welcome to the pool</h1>
      <p className="setup-sub">Sign in to make your picks.</p>
      <div className="standings-toggle auth-toggle">
        <button
          type="button"
          className={mode === 'signin' ? 'active' : ''}
          onClick={() => setMode('signin')}
        >
          Sign in
        </button>
        <button
          type="button"
          className={mode === 'signup' ? 'active' : ''}
          onClick={() => setMode('signup')}
        >
          Create account
        </button>
      </div>
      <input
        className="setup-input"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
      />
      <input
        className="setup-input"
        type="password"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        placeholder={mode === 'signin' ? 'Password' : 'Choose a password (6+ characters)'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && <p className="auth-error">{error}</p>}
      <button
        type="button"
        className="submit-btn setup-btn"
        disabled={!valid || busy}
        onClick={submit}
      >
        {busy ? 'One sec…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
      {mode === 'signin' && (
        <button
          type="button"
          className="auth-forgot"
          disabled={!emailValid || busy}
          title={emailValid ? undefined : 'Enter your email above first'}
          onClick={() => onForgot(email.trim())}
        >
          Forgot password? {emailValid ? '' : '(enter your email above)'}
        </button>
      )}
    </>
  );
}

function NewPasswordForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const valid = password.length >= 6;
  return (
    <>
      <h1 className="setup-title">Set a new password</h1>
      <p className="setup-sub">You’ll use this to sign in from now on.</p>
      <input
        className="setup-input"
        type="password"
        autoComplete="new-password"
        placeholder="New password (6+ characters)"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && valid && onSubmit(password)}
        autoFocus
      />
      {error && <p className="auth-error">{error}</p>}
      <button
        type="button"
        className="submit-btn setup-btn"
        disabled={!valid || busy}
        onClick={() => onSubmit(password)}
      >
        {busy ? 'Saving…' : 'Save password'}
      </button>
    </>
  );
}

function NameForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <>
      <h1 className="setup-title">What should we call you?</h1>
      <p className="setup-sub">This name shows up on the scoreboard and standings.</p>
      <input
        className="setup-input"
        placeholder="Your name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSubmit(name.trim())}
        autoFocus
      />
      {error && <p className="auth-error">{error}</p>}
      <button
        type="button"
        className="submit-btn setup-btn"
        disabled={!name.trim() || busy}
        onClick={() => onSubmit(name.trim())}
      >
        Continue
      </button>
    </>
  );
}
