// Supabase client for React Native. Auth sessions persist in AsyncStorage and
// tokens only refresh while the app is foregrounded (Supabase's recommended
// RN pattern). Unlike web (env-file driven with a local fallback), mobile
// ships the public client config baked in — the publishable key is designed
// to ship in client bundles; RLS protects the data. Mirrors
// web/.env.production.

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const url = 'https://nczxyombguocejgurwop.supabase.co';
const anonKey = 'sb_publishable_jcJJSw7nfMx3e3iQwprRnA_qnk4bVJI';

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
