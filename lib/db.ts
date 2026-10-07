import { serviceClient } from '@/lib/supabase/server';
import { redact } from '@/lib/privacy/redact';

// Thin server-side data helpers. All personal-data access goes through here and
// is audited. client_id is ALWAYS passed by the caller (from the session), never
// from the model. Table/column names follow supabase/migrations/0001_schema.sql.

export async function audit(
  action: string,
  opts: { clientId?: string | null; entity?: string; entityId?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const db = serviceClient();
    await db.from('audit_log').insert({
      actor: opts.clientId ? `client:${opts.clientId}` : 'system',
      action,
      entity: opts.entity ?? null,
      entity_id: opts.entityId ?? null,
      meta: opts.meta ?? {},
    });
  } catch (e) {
    console.error('[audit]', action, redact(String(e)));
  }
}

export type SessionRow = {
  id: string;
  client_id: string | null;
  verified_until: string | null;
  language: string;
  ip_hash: string | null;
  last_seen_at: string | null;
};

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const db = serviceClient();
  const { data } = await db.from('chat_sessions').select('*').eq('id', sessionId).maybeSingle();
  return (data as SessionRow | null) ?? null;
}

export function isVerified(session: SessionRow | null, now = new Date()): boolean {
  if (!session?.client_id || !session.verified_until) return false;
  return new Date(session.verified_until).getTime() > now.getTime();
}

export async function touchSession(sessionId: string): Promise<void> {
  const db = serviceClient();
  await db.from('chat_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', sessionId);
}

export async function appendMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system' | 'staff',
  content: string,
  opts: { ui?: unknown; sources?: unknown; redactedText?: string } = {},
): Promise<string | null> {
  const db = serviceClient();
  const { data } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role,
      content: opts.redactedText ?? content,
      sources: opts.sources ?? null,
      redacted: true,
    })
    .select('id')
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

export async function recentMessages(
  conversationId: string,
  limit = 20,
): Promise<{ role: string; content: string }[]> {
  const db = serviceClient();
  const { data } = await db
    .from('messages')
    .select('role,content,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  const rows = (data as { role: string; content: string }[] | null) ?? [];
  return rows.reverse();
}

export async function getConversation(conversationId: string) {
  const db = serviceClient();
  const { data } = await db.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  return data as { id: string; client_id: string | null; language: string; channel: string } | null;
}

export async function createConversation(clientId: string | null, language = 'en') {
  const db = serviceClient();
  const { data } = await db
    .from('conversations')
    .insert({ client_id: clientId, language, channel: 'web', status: 'active' })
    .select('id')
    .single();
  return data as { id: string };
}
