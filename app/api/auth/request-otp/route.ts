import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { loadOrCreateSession, hashIp, SESSION_COOKIE_NAME, CONV_COOKIE_NAME } from '@/lib/auth/session';
import { requestOtp, confirmOtp, normalizePhone } from '@/lib/auth/otp';
import { getSession } from '@/lib/db';
import { maskPhone } from '@/lib/privacy/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/request-otp  { phone }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { phone?: string; purpose?: string };
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const { session, conversationId, isNew } = await loadOrCreateSession();
  const res = await requestOtp(body.phone ?? '', session, hashIp(ip));

  if (!res.ok) return Response.json({ error: res.error }, { status: 400 });

  const headers = new Headers({ 'content-type': 'application/json' });
  if (isNew) {
    headers.append('set-cookie', cookie(SESSION_COOKIE_NAME, session.id));
    headers.append('set-cookie', cookie(CONV_COOKIE_NAME, conversationId));
  }
  return new Response(
    JSON.stringify({
      ok: true,
      phoneMasked: maskPhone(normalizePhone(body.phone ?? '') ?? ''),
      demo: res.demo,
      hint: res.demo ? 'DEMO: use 123456' : undefined,
    }),
    { headers },
  );
}

function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}
