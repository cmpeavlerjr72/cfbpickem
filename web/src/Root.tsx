// Entry composition: Supabase mode goes through AuthGate (email/password +
// pool membership); without env credentials we fall back to the original
// single-browser local store so the app still runs offline.

import { useEffect, useState } from 'react';
import App from './App';
import { AuthGate } from './components/AuthGate';
import { PoolSetup } from './components/PoolSetup';
import { localPoolStore } from './pool/store';
import { supabaseEnabled } from './pool/supabase';
import type { PoolProfile } from './pool/types';

export default function Root() {
  if (supabaseEnabled) {
    return (
      <AuthGate>
        {(ctx) => (
          <App
            store={ctx.store}
            profile={ctx.profile}
            inviteCode={ctx.inviteCode}
            onSignOut={ctx.signOut}
          />
        )}
      </AuthGate>
    );
  }
  return <LocalGate />;
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
