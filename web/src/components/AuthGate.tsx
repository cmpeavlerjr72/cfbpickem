// Sign-in and pool-membership gate for the Supabase backend:
// email magic link → display name (first visit) → create or join a pool.
// Renders children once the member is resolved.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../pool/supabase';
import { SupabasePoolStore } from '../pool/store';
import type { PoolProfile } from '../pool/types';

export interface PoolContext {
  store: SupabasePoolStore;
  profile: PoolProfile;
  poolName: string;
  inviteCode: string;
  signOut: () => void;
}

type Phase = 'loading' | 'signedOut' | 'checkEmail' | 'needName' | 'needPool' | 'ready';

export function AuthGate({ children }: { children: (ctx: PoolContext) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<PoolContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(() => {
    supabase!.auth.signOut();
    setCtx(null);
    setPhase('signedOut');
  }, []);

  const resolveMember = useCallback(
    async (s: Session) => {
      const userId = s.user.id;
      const { data: prof } = await supabase!
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      if (!prof) {
        setPhase('needName');
        return;
      }
      const { data: member } = await supabase!
        .from('pool_members')
        .select('pool_id, is_commissioner, pools(name, invite_code)')
        .eq('player_id', userId)
        .limit(1)
        .maybeSingle();
      if (!member) {
        setPhase('needPool');
        return;
      }
      const pool = member.pools as unknown as { name: string; invite_code: string } | null;
      const profile: PoolProfile = {
        playerId: userId,
        playerName: prof.display_name,
        isCommissioner: member.is_commissioner,
      };
      setCtx({
        store: new SupabasePoolStore(member.pool_id, profile),
        profile,
        poolName: pool?.name ?? 'Pool',
        inviteCode: pool?.invite_code ?? '',
        signOut,
      });
      setPhase('ready');
    },
    [signOut],
  );

  useEffect(() => {
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) resolveMember(data.session);
      else setPhase('signedOut');
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s) resolveMember(s);
      if (event === 'SIGNED_OUT') setPhase('signedOut');
    });
    return () => sub.subscription.unsubscribe();
  }, [resolveMember]);

  if (phase === 'ready' && ctx) return <>{children(ctx)}</>;
  if (phase === 'loading') return null;

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-logo">🏈</div>
        {phase === 'signedOut' && (
          <EmailForm
            busy={busy}
            error={error}
            onSubmit={async (email) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase!.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: window.location.origin },
              });
              setBusy(false);
              if (err) setError(err.message);
              else setPhase('checkEmail');
            }}
          />
        )}
        {phase === 'checkEmail' && (
          <>
            <h1 className="setup-title">Check your email</h1>
            <p className="setup-sub">
              We sent you a sign-in link. Open it on this device and you’ll land right back
              here, signed in.
            </p>
            <button type="button" className="ghost-btn setup-btn" onClick={() => setPhase('signedOut')}>
              Use a different email
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
              else resolveMember(session);
            }}
          />
        )}
        {phase === 'needPool' && session && (
          <PoolForm
            busy={busy}
            error={error}
            onCreate={async (name) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase!.rpc('create_pool', { p_name: name });
              setBusy(false);
              if (err) setError(err.message);
              else resolveMember(session);
            }}
            onJoin={async (code) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase!.rpc('join_pool', { p_code: code });
              setBusy(false);
              if (err) setError(err.message.includes('invalid') ? 'Invalid invite code.' : err.message);
              else resolveMember(session);
            }}
            onSignOut={signOut}
          />
        )}
      </div>
    </div>
  );
}

function EmailForm({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (email: string) => void;
}) {
  const [email, setEmail] = useState('');
  const valid = /\S+@\S+\.\S+/.test(email);
  return (
    <>
      <h1 className="setup-title">Welcome to the pool</h1>
      <p className="setup-sub">
        Pick 12 games against the spread each week. Sign in with your email — no password,
        we’ll send you a link.
      </p>
      <input
        className="setup-input"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && valid && onSubmit(email.trim())}
        autoFocus
      />
      {error && <p className="auth-error">{error}</p>}
      <button
        type="button"
        className="submit-btn setup-btn"
        disabled={!valid || busy}
        onClick={() => onSubmit(email.trim())}
      >
        {busy ? 'Sending…' : 'Send sign-in link'}
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

function PoolForm({
  busy,
  error,
  onCreate,
  onJoin,
  onSignOut,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (name: string) => void;
  onJoin: (code: string) => void;
  onSignOut: () => void;
}) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  return (
    <>
      <h1 className="setup-title">Join your pool</h1>
      <div className="standings-toggle auth-toggle">
        <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
          I have an invite code
        </button>
        <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
          Start a new pool
        </button>
      </div>
      {mode === 'join' ? (
        <>
          <input
            className="setup-input invite-input"
            placeholder="ABC123"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && code.trim() && onJoin(code.trim())}
            autoFocus
          />
          {error && <p className="auth-error">{error}</p>}
          <button
            type="button"
            className="submit-btn setup-btn"
            disabled={code.trim().length < 6 || busy}
            onClick={() => onJoin(code.trim())}
          >
            Join pool
          </button>
        </>
      ) : (
        <>
          <input
            className="setup-input"
            placeholder="Pool name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate(name.trim())}
            autoFocus
          />
          {error && <p className="auth-error">{error}</p>}
          <button
            type="button"
            className="submit-btn setup-btn"
            disabled={busy}
            onClick={() => onCreate(name.trim())}
          >
            Create pool (you’ll be commissioner)
          </button>
        </>
      )}
      <button type="button" className="auth-signout" onClick={onSignOut}>
        Sign out
      </button>
    </>
  );
}
