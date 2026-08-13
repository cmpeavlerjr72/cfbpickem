// Supabase client. When the env vars are missing (e.g. a fresh checkout
// without web/.env.local) the app falls back to the local, single-browser
// store so dev still works offline.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseEnabled = !!url && !!anonKey;

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(url!, anonKey!)
  : null;
