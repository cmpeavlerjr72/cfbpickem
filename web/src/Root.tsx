// Entry composition: Supabase mode goes through AuthGate (email/password),
// then the league switcher — dashboard when no league is selected, the pool
// app once one is. The device remembers your last league. Without env
// credentials we fall back to the original single-browser local store so
// the app still runs offline.

import { useEffect, useMemo, useState } from 'react';
import App from './App';
import { AuthGate, type AccountContext } from './components/AuthGate';
import { Dashboard } from './components/Dashboard';
import { InstallPrompt } from './components/InstallPrompt';
import { PoolSetup } from './components/PoolSetup';
import { localPoolStore, SupabasePoolStore } from './pool/store';
import { supabaseEnabled } from './pool/supabase';
import type { PoolProfile } from './pool/types';

const LAST_POOL_KEY = 'cfb-pickem:pool:last';

export default function Root() {
  // The install bar is mounted ONCE here, at the app shell, so it shows on
  // every surface — sign-in, the league dashboard and the pool app alike.
  // Mounting it per-screen meant it only appeared on whichever page happened
  // to include it (the user found it on Leagues and nowhere else), and two
  // instances could race the same single-use install event.
  return (
    <>
      <InstallPrompt />
      {supabaseEnabled ? (
        <AuthGate>{(account) => <LeagueSwitcher account={account} />}</AuthGate>
      ) : (
        <LocalGate />
      )}
    </>
  );
}

function LeagueSwitcher({ account }: { account: AccountContext }) {
  const [poolId, setPoolId] = useState<string | null>(() => {
    const remembered = localStorage.getItem(LAST_POOL_KEY);
    if (remembered && account.memberships.some((m) => m.poolId === remembered)) return remembered;
    return account.memberships.length === 1 ? account.memberships[0].poolId : null;
  });

  const select = (id: string | null) => {
    setPoolId(id);
    try {
      if (id) localStorage.setItem(LAST_POOL_KEY, id);
      else localStorage.removeItem(LAST_POOL_KEY);
    } catch {
      // storage unavailable — selection just won't persist
    }
  };

  const membership = account.memberships.find((m) => m.poolId === poolId) ?? null;

  const profile = useMemo<PoolProfile | null>(
    () =>
      membership
        ? {
            playerId: account.userId,
            playerName: account.displayName,
            isCommissioner: membership.isCommissioner,
          }
        : null,
    [membership, account.userId, account.displayName],
  );

  const store = useMemo(
    () => (membership && profile ? new SupabasePoolStore(membership.poolId, profile) : null),
    [membership, profile],
  );

  if (!membership || !profile || !store) {
    return <Dashboard account={account} onSelect={select} />;
  }

  return (
    <App
      key={membership.poolId}
      store={store}
      profile={profile}
      inviteCode={membership.inviteCode}
      poolName={membership.poolName}
      onSignOut={account.signOut}
      onSwitchLeague={() => select(null)}
    />
  );
}

function LocalGate() {
  const [profile, setProfile] = useState<PoolProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    localPoolStore.getProfile().then((p) => {
      setProfile(p);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return null;
  if (!profile) {
    return (
      <PoolSetup
        onDone={(p) => {
          localPoolStore.saveProfile(p);
          setProfile(p);
        }}
      />
    );
  }
  return <App store={localPoolStore} profile={profile} />;
}
