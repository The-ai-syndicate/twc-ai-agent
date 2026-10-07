import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';

// Browser client using the ANON key. Used only for Realtime subscriptions and
// public-read content (sites, services, notices). Never holds the service key.
let cached: SupabaseClient | null = null;

export function browserClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(config.supabase.url, config.supabase.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
