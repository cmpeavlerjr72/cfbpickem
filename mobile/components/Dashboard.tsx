// The account dashboard — mirrors web/src/components/Dashboard.tsx (see
// CLAUDE.md parity rule): every league you're in (tap to enter), join by
// invite code, start a new league, and account settings (display name,
// password, sign out, delete account).

import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../pool/supabase';
import type { AccountContext } from './AuthGate';
import { colors } from '../theme';

interface DashboardProps {
  account: AccountContext;
  onSelect: (poolId: string) => void;
}

export function Dashboard({ account, onSelect }: DashboardProps) {
  const [joinCode, setJoinCode] = useState('');
  const [newName, setNewName] = useState('');
  const [displayName, setDisplayName] = useState(account.displayName);
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      const { data, error: err } = await supabase.rpc('join_pool', { p_code: joinCode.trim() });
      if (err) throw new Error(err.message.includes('invalid') ? 'Invalid invite code.' : err.message);
      await account.refresh();
      setJoinCode('');
      if (data) onSelect(data as string);
      return null;
    });

  const createLeague = () =>
    run(async () => {
      const { data, error: err } = await supabase.rpc('create_pool', { p_name: newName.trim() });
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
      const { error: err } = await supabase
        .from('profiles')
        .update({ display_name: name })
        .eq('id', account.userId);
      if (err) throw new Error(err.message);
      await account.refresh();
      return 'Display name updated.';
    });

  const savePassword = () =>
    run(async () => {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) throw new Error(err.message);
      setNewPassword('');
      return 'Password updated.';
    });

  // Apple Guideline 5.1.1(v): account deletion has to be doable in-app. The
  // delete_account RPC tidies up leagues (promoting a new commissioner if
  // needed) and deletes the auth user, which cascades profile/picks away.
  const deleteAccount = () =>
    run(async () => {
      const { error: err } = await supabase.rpc('delete_account');
      if (err) throw new Error(err.message);
      // account.signOut() calls supabase.auth.signOut(); the server side of
      // that can fail now that the user is gone, but it clears the local
      // session regardless and AuthGate drops back to the sign-in screen.
      account.signOut();
      return null;
    });

  const confirmDeleteAccount = () =>
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, your picks, and removes you from your ' +
        'leagues. If you’re the only commissioner of a league, the longest-standing ' +
        'member becomes commissioner.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.logo}>🏈</Text>
          <View>
            <Text style={styles.title}>Your leagues</Text>
            <Text style={styles.sub}>Signed in as {account.displayName}</Text>
          </View>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
        {notice && <Text style={styles.notice}>{notice}</Text>}

        <View style={styles.card}>
          {account.memberships.length === 0 ? (
            <Text style={styles.empty}>
              You’re not in a league yet — join one with an invite code below, or start your
              own.
            </Text>
          ) : (
            <View style={styles.leagues}>
              {account.memberships.map((m) => (
                <Pressable key={m.poolId} style={styles.league} onPress={() => onSelect(m.poolId)}>
                  <View style={styles.leagueMain}>
                    <Text style={styles.leagueName}>{m.poolName}</Text>
                    <Text style={styles.leagueMeta}>
                      {m.isCommissioner ? 'Commissioner' : 'Player'}
                      {m.inviteCode ? ` · invite ${m.inviteCode}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.leagueGo}>›</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Join a league</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.inviteInput]}
              placeholder="ABC123"
              placeholderTextColor={colors.textDim}
              value={joinCode}
              maxLength={6}
              autoCapitalize="characters"
              onChangeText={(t) => setJoinCode(t.toUpperCase())}
            />
            <Pressable
              style={[styles.btn, (joinCode.trim().length < 6 || busy) && styles.btnDisabled]}
              disabled={joinCode.trim().length < 6 || busy}
              onPress={joinLeague}
            >
              <Text style={styles.btnText}>Join</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Start a new league</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              placeholder="League name"
              placeholderTextColor={colors.textDim}
              value={newName}
              maxLength={60}
              onChangeText={setNewName}
            />
            <Pressable
              style={[styles.btn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={createLeague}
            >
              <Text style={styles.btnText}>Create</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>You’ll be the commissioner: you set the slate each week.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              placeholder="Display name"
              placeholderTextColor={colors.textDim}
              value={displayName}
              maxLength={40}
              onChangeText={setDisplayName}
            />
            <Pressable
              style={[
                styles.ghostBtn,
                (busy || !displayName.trim() || displayName.trim() === account.displayName) &&
                  styles.btnDisabled,
              ]}
              disabled={busy || !displayName.trim() || displayName.trim() === account.displayName}
              onPress={saveName}
            >
              <Text style={styles.ghostBtnText}>Save</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Your name on every league’s scoreboard and standings.</Text>
          <View style={styles.row}>
            <TextInput
              style={styles.input}
              placeholder="New password (6+ characters)"
              placeholderTextColor={colors.textDim}
              value={newPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              onChangeText={setNewPassword}
            />
            <Pressable
              style={[styles.ghostBtn, (busy || newPassword.length < 6) && styles.btnDisabled]}
              disabled={busy || newPassword.length < 6}
              onPress={savePassword}
            >
              <Text style={styles.ghostBtnText}>Update</Text>
            </Pressable>
          </View>
          <Pressable style={styles.signOut} onPress={account.signOut}>
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.cardTitle}>Delete account</Text>
          <Text style={styles.hint}>
            Permanently removes your account, your picks, and your league memberships. This
            can’t be undone.
          </Text>
          <Pressable
            style={[styles.dangerLink, busy && styles.btnDisabled]}
            disabled={busy}
            onPress={confirmDeleteAccount}
          >
            <Text style={styles.dangerLinkText}>Delete account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  logo: {
    fontSize: 34,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
  },
  sub: {
    fontSize: 13,
    color: colors.textDim,
    marginTop: 2,
  },
  error: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.red,
  },
  notice: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.green,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 10,
  },
  leagues: {
    gap: 8,
  },
  league: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  leagueMain: {
    flex: 1,
  },
  leagueName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  leagueMeta: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 2,
  },
  leagueGo: {
    fontSize: 18,
    color: colors.textDim,
  },
  empty: {
    fontSize: 14,
    color: colors.textDim,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
    marginBottom: 4,
  },
  input: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
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
  btn: {
    backgroundColor: colors.green,
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  hint: {
    fontSize: 12,
    color: colors.textDim,
    marginBottom: 8,
  },
  signOut: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  signOutText: {
    fontSize: 13,
    color: colors.textDim,
    textDecorationLine: 'underline',
  },
  dangerCard: {
    borderColor: colors.red,
  },
  dangerLink: {
    alignSelf: 'flex-start',
  },
  dangerLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.red,
    textDecorationLine: 'underline',
  },
});
