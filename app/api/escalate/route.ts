import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { serviceClient } from '@/lib/supabase/server';
import { getSession, audit } from '@/lib/db';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/escalate — client explicitly asks for a human (button in the UI).
// Body: { conversationId?: string, reason?: string }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; reason?: string };
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionId ? await getSession(sessionId) : null;
  if (!session) return Response.json({ error: 'No active session.' }, { status: 400 });

  const db = serviceClient();
  let conversationId = body.conversationId ?? '';
  if (!conversationId) {
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('client_id', session.client_id ?? '')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    conversationId = (data as { id: string } | null)?.id ?? '';
  }
  if (!conversationId) {
    return Response.json({ error: 'Could not find your conversation.' }, { status: 400 });
  }

  const { data: esc } = await db
    .from('escalations')
    .insert({
      conversation_id: conversationId,
      priority: 'high',
      reason: body.reason?.slice(0, 200) || 'Client asked for a person',
      summary: 'Client requested a human team member.',
      status: 'open',
    })
    .select('id,priority')
    .single();

  await db.from('conversations').update({ status: 'escalated' }).eq('id', conversationId);
  await audit('escalation.created', { clientId: session.client_id, meta: { source: 'client_button' } });

  return Response.json({
    ok: true,
    escalationId: (esc as { id: string } | null)?.id ?? null,
    message:
      'A TWC team member has been notified and will join this chat. Typical response during working hours is a few minutes. If it is urgent right now, please also call Ambulance 997 or Police 999.',
  });
}
