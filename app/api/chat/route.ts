import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { loadOrCreateSession, hashIp, SESSION_COOKIE_NAME, CONV_COOKIE_NAME } from '@/lib/auth/session';
import { runChatTurn } from '@/lib/llm/orchestrator';
import { config } from '@/lib/config';
import type { StreamEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/chat — streaming (SSE) conversation endpoint.
// Body: { message: string, language?: 'en' | 'tn' }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { message?: string; language?: string };
  const message = (body.message ?? '').toString();
  const language = body.language === 'tn' ? 'tn' : 'en';

  if (message.length > config.limits.maxMessageChars) {
    return new Response(
      JSON.stringify({ error: `Message too long (max ${config.limits.maxMessageChars} characters).` }),
      { status: 413, headers: { 'content-type': 'application/json' } },
    );
  }

  // Simple per-IP rate limit on chat (in-memory; swap for a durable store later).
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  if (!allowRate(`chat:${ip ?? 'anon'}`, config.limits.chatPerMinute)) {
    return new Response(JSON.stringify({ error: 'Too many messages. Please wait a moment.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { session, conversationId, isNew } = await loadOrCreateSession(language);

  const jar = await cookies();
  const setCookies: string[] = [];
  if (isNew) {
    setCookies.push(cookie(SESSION_COOKIE_NAME, session.id, 60 * 60 * 24 * 30));
    setCookies.push(cookie(CONV_COOKIE_NAME, conversationId, 60 * 60 * 24 * 30));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        for await (const event of runChatTurn({
          sessionId: session.id,
          conversationId,
          userText: message,
          ipHash: hashIp(ip),
        })) {
          send(event);
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'error' });
      } finally {
        controller.enqueue(encoder.encode('event: close\ndata: {}\n\n'));
        controller.close();
      }
    },
  });

  const headers = new Headers({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'x-session-verified': String(!!session.verified_until),
  });
  for (const c of setCookies) headers.append('set-cookie', c);
  return new Response(stream, { headers });
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

// --- tiny in-memory rate limiter (per process) -------------------------------
const hits = new Map<string, number[]>();
function allowRate(key: string, perMinute: number): boolean {
  const now = Date.now();
  const window = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (window.length >= perMinute) {
    hits.set(key, window);
    return false;
  }
  window.push(now);
  hits.set(key, window);
  return true;
}
