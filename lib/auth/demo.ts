// Demo-mode session linking shared by the OTP flow and the in-chat booking
// flow. In DEMO_MODE we reuse (or create) a lightweight demo client and mark
// the session verified so personal-data writes work without an SMS round-trip.

import { serviceClient } from '@/lib/supabase/server';
import { audit } from '@/lib/db';
import { config } from '@/lib/config';

export async function linkDemoClientForSession(sessionId: string): Promise<string> {
  const db = serviceClient();

  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq('demo', true)
    .limit(1)
    .maybeSingle();

  let clientId = (existing as { id: string } | null)?.id;
  if (!clientId) {
    const { data: created } = await db
      .from('clients')
      .insert({ first_name: 'Demo', preferred_language: 'en', demo: true })
      .select('id')
      .single();
    clientId = (created as { id: string } | null)?.id ?? '';
  }

  const verifiedUntil = new Date(
    Date.now() + config.limits.verifiedSessionMinutes * 60_000,
  ).toISOString();
  await db
    .from('chat_sessions')
    .update({ client_id: clientId, verified_until: verifiedUntil })
    .eq('id', sessionId);

  await audit('auth.login', { clientId, meta: { demo: true, source: 'in_chat_booking' } });
  return clientId;
}
