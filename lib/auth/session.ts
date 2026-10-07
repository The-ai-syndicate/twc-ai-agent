import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { serviceClient } from '@/lib/supabase/server';
import { getConversation, type SessionRow } from '@/lib/db';

// Session + conversation bootstrap. The session id is an opaque server-issued
// cookie; the browser never sends a client_id. Verification state lives in DB.

const SESSION_COOKIE = 'twc_session';
const CONV_COOKIE = 'twc_conv';

export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const pepper = process.env.OTP_PEPPER ?? 'twc-demo-pepper';
  return createHash('sha256').update(ip + pepper).digest('hex').slice(0, 32);
}

export type Bootstrapped = { session: SessionRow; conversationId: string; isNew: boolean };

/**
 * Load (or create) the current chat session and its active conversation.
 * Safe to call from route handlers. Cookies are set by the caller route.
 */
export async function loadOrCreateSession(language = 'en'): Promise<Bootstrapped> {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE)?.value;
  const convId = jar.get(CONV_COOKIE)?.value;
  const db = serviceClient();

  // Existing session?
  if (sessionId) {
    const { data } = await db.from('chat_sessions').select('*').eq('id', sessionId).maybeSingle();
    const session = data as SessionRow | null;
    if (session) {
      let conversationId = convId ?? '';
      const conv = conversationId ? await getConversation(conversationId) : null;
      if (!conv) {
        const created = await createConversation(session.client_id, language);
        conversationId = created.id;
      }
      return { session, conversationId, isNew: false };
    }
  }

  // New session.
  const { data: created } = await db
    .from('chat_sessions')
    .insert({ language, last_seen_at: new Date().toISOString() })
    .select('*')
    .single();
  const session = created as SessionRow;
  const conv = await createConversation(session.client_id, language);
  return { session, conversationId: conv.id, isNew: true };
}

async function createConversation(clientId: string | null, language: string) {
  const db = serviceClient();
  const { data } = await db
    .from('conversations')
    .insert({ client_id: clientId, language, channel: 'web', status: 'active' })
    .select('id')
    .single();
  return data as { id: string };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const CONV_COOKIE_NAME = CONV_COOKIE;
