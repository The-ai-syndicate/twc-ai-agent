import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '@/lib/config';

// Server-side Supabase client using the SERVICE ROLE key.
// NEVER import this into client components. All personal-data access is
// mediated here, with client_id injected from the verified session (never the model).
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (!config.supabase.url || !config.supabase.serviceRoleKey) {
    throw new Error('Supabase service credentials are not configured');
  }
  if (!cached) {
    cached = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
