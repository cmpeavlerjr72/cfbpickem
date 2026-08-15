// Sign-in and pool-membership gate — mirrors web/src/components/AuthGate.tsx
// (see CLAUDE.md parity rule): email + password → display name (first visit)
// → create or join a pool. One mobile-specific difference: password-reset
// links open the WEBSITE (there's no deep link into the app), so the flow is
// "reset there, then sign in here".

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../pool/supabase';
import { SupabasePoolStore } from '../pool/store';
import type { PoolProfile } from '../pool/types';
import { colors } from '../theme';

const SITE_URL = 'https://pattersonpickem.onrender.com';

export interface PoolContext {
  store: SupabasePoolStore;
  profile: PoolProfile;
  poolName: string;
  inviteCode: string;
  signOut: () => void;
}

type Phase = 'loading' | 'signedOut' | 'resetSent' | 'confirmSent' | 'needName' | 'needPool' | 'ready';

export function AuthGate({ children }: { children: (ctx: PoolContext) => ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [ctx, setCtx] = useState<PoolContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = useCallback(() => {
    supabase.auth.signOut();
    setCtx(null);
    setPhase('signedOut');
  }, []);

  const resolveMember = useCallback(
    async (s: Session) => {
      const userId = s.user.id;
      const { data: prof } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();
      if (!prof) {
        setPhase('needName');
        return;
      }
      const { data: member } = await supabase
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) resolveMember(data.session);
      else setPhase('signedOut');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' && s) resolveMember(s);
      if (event === 'SIGNED_OUT') setPhase('signedOut');
    });
    return () => sub.subscription.unsubscribe();
  }, [resolveMember]);

  if (phase === 'ready' && ctx) return <>{children(ctx)}</>;
  if (phase === 'loading') {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.logo}>🏈</Text>
        {phase === 'signedOut' && (
          <CredentialsForm
            busy={busy}
            error={error}
            onSignIn={async (email, password) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase.auth.signInWithPassword({ email, password });
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
              const { data, error: err } = await supabase.auth.signUp({ email, password });
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
              const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: SITE_URL,
              });
              setBusy(false);
              if (err) setError(err.message);
              else setPhase('resetSent');
            }}
          />
        )}
        {phase === 'resetSent' && (
          <>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.sub}>
              We sent a password-reset link. It opens the pool website — choose a new password
              there, then come back and sign in here.
            </Text>
            <Pressable style={styles.ghostBtn} onPress={() => setPhase('signedOut')}>
              <Text style={styles.ghostBtnText}>Back to sign in</Text>
            </Pressable>
          </>
        )}
        {phase === 'confirmSent' && (
          <>
            <Text style={styles.title}>Confirm your email</Text>
            <Text style={styles.sub}>
              We sent a confirmation link to your email. Click it, then come back and sign in.
            </Text>
            <Pressable style={styles.ghostBtn} onPress={() => setPhase('signedOut')}>
              <Text style={styles.ghostBtnText}>Back to sign in</Text>
            </Pressable>
          </>
        )}
        {phase === 'needName' && session && (
          <NameForm
            busy={busy}
            error={error}
            onSubmit={async (name) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase
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
              const { error: err } = await supabase.rpc('create_pool', { p_name: name });
              setBusy(false);
              if (err) setError(err.message);
              else resolveMember(session);
            }}
            onJoin={async (code) => {
              setBusy(true);
              setError(null);
              const { error: err } = await supabase.rpc('join_pool', { p_code: code });
              setBusy(false);
              if (err) setError(err.message.includes('invalid') ? 'Invalid invite code.' : err.message);
              else resolveMember(session);
            }}
            onSignOut={signOut}
          />
        )}
      </View>
    </View>
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
      <Text style={styles.title}>Welcome to the pool</Text>
      <Text style={styles.sub}>Sign in to make your picks.</Text>
      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, mode === 'signin' && styles.toggleBtnActive]}
          onPress={() => setMode('signin')}
        >
          <Text style={[styles.toggleText, mode === 'signin' && styles.toggleTextActive]}>
            Sign in
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, mode === 'signup' && styles.toggleBtnActive]}
          onPress={() => setMode('signup')}
        >
          <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
            Create account
          </Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        placeholderTextColor={colors.textDim}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder={mode === 'signin' ? 'Password' : 'Choose a password (6+ characters)'}
        placeholderTextColor={colors.textDim}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
        onSubmitEditing={submit}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.submitBtn, (!valid || busy) && styles.submitBtnDisabled]}
        disabled={!valid || busy}
        onPress={submit}
      >
        <Text style={styles.submitBtnText}>
          {busy ? 'One sec…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </Text>
      </Pressable>
      {mode === 'signin' && (
        <Pressable
          style={styles.linkBtn}
          disabled={!emailValid || busy}
          onPress={() => onForgot(email.trim())}
        >
          <Text style={styles.linkBtnText}>
            Forgot password? {emailValid ? '' : '(enter your email above)'}
          </Text>
        </Pressable>
      )}
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
      <Text style={styles.title}>What should we call you?</Text>
      <Text style={styles.sub}>This name shows up on the scoreboard and standings.</Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor={colors.textDim}
        value={name}
        maxLength={40}
        onChangeText={setName}
        onSubmitEditing={() => name.trim() && onSubmit(name.trim())}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        style={[styles.submitBtn, (!name.trim() || busy) && styles.submitBtnDisabled]}
        disabled={!name.trim() || busy}
        onPress={() => onSubmit(name.trim())}
      >
        <Text style={styles.submitBtnText}>Continue</Text>
      </Pressable>
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
      <Text style={styles.title}>Join your pool</Text>
      <View style={styles.toggle}>
        <Pressable
          style={[styles.toggleBtn, mode === 'join' && styles.toggleBtnActive]}
          onPress={() => setMode('join')}
        >
          <Text style={[styles.toggleText, mode === 'join' && styles.toggleTextActive]}>
            I have an invite code
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, mode === 'create' && styles.toggleBtnActive]}
          onPress={() => setMode('create')}
        >
          <Text style={[styles.toggleText, mode === 'create' && styles.toggleTextActive]}>
            Start a new pool
          </Text>
        </Pressable>
      </View>
      {mode === 'join' ? (
        <>
          <TextInput
            style={[styles.input, styles.inviteInput]}
            placeholder="ABC123"
            placeholderTextColor={colors.textDim}
            value={code}
            maxLength={6}
            autoCapitalize="characters"
            onChangeText={(t) => setCode(t.toUpperCase())}
            onSubmitEditing={() => code.trim() && onJoin(code.trim())}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.submitBtn, (code.trim().length < 6 || busy) && styles.submitBtnDisabled]}
            disabled={code.trim().length < 6 || busy}
            onPress={() => onJoin(code.trim())}
          >
            <Text style={styles.submitBtnText}>Join pool</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="Pool name"
            placeholderTextColor={colors.textDim}
            value={name}
            maxLength={60}
            onChangeText={setName}
            onSubmitEditing={() => onCreate(name.trim())}
          />
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable
            style={[styles.submitBtn, busy && styles.submitBtnDisabled]}
            disabled={busy}
            onPress={() => onCreate(name.trim())}
          >
            <Text style={styles.submitBtnText}>Create pool (you’ll be commissioner)</Text>
          </Pressable>
        </>
      )}
      <Pressable style={styles.linkBtn} onPress={onSignOut}>
        <Text style={styles.linkBtnText}>Sign out</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  logo: {
    fontSize: 40,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 6,
  },
  toggle: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 4,
    marginTop: 16,
    alignSelf: 'stretch',
  },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: colors.navy,
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textDim,
    textAlign: 'center',
  },
  toggleTextActive: {
    color: '#fff',
  },
  input: {
    alignSelf: 'stretch',
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.text,
  },
  inviteInput: {
    textAlign: 'center',
    letterSpacing: 4,
    fontWeight: '800',
  },
  error: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: colors.red,
    textAlign: 'center',
  },
  submitBtn: {
    alignSelf: 'stretch',
    marginTop: 14,
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  submitBtnDisabled: {
    backgroundColor: colors.border,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  ghostBtn: {
    marginTop: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 18,
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  linkBtn: {
    marginTop: 14,
  },
  linkBtnText: {
    fontSize: 13,
    color: colors.textDim,
    textDecorationLine: 'underline',
  },
});
