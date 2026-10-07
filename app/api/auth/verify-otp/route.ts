import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/db';
import { confirmOtp } from '@/lib/auth/otp';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/verify-otp  { code }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { code?: string; conversationId?: string };
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionId ? await getSession(sessionId) : null;
  if (!session) return Response.json({ error: 'No active session. Please reload.' }, { status: 400 });

  const res = await confirmOtp(body.code ?? '', session, body.conversationId ?? '');
  if (!res.ok) return Response.json({ error: res.error }, { status: 400 });
  return Response.json({ ok: true, verified: true });
}
