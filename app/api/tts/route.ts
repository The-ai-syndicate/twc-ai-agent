import { NextRequest } from 'next/server';
import { getTtsProvider } from '@/lib/tts/provider';
import { config } from '@/lib/config';
import { redact } from '@/lib/privacy/redact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/tts — proxy to the TTS provider. The API key never leaves the server.
// Body: { text: string, language?: 'en' | 'tn' }
// Setswana is text-only (provider limitation) -> 415 with a clear reason.
export async function POST(req: NextRequest) {
  const { text, language } = (await req.json().catch(() => ({}))) as { text?: string; language?: 'en' | 'tn' };
  const lang = language === 'tn' ? 'tn' : 'en';
  const clean = (text ?? '').toString().slice(0, 1200).trim();

  if (!clean) {
    return Response.json({ error: 'No text to speak.' }, { status: 400 });
  }
  if (!allowRate(`tts:${req.headers.get('x-forwarded-for') ?? 'anon'}`, 30)) {
    return Response.json({ error: 'Too many voice requests. Please wait a moment.' }, { status: 429 });
  }

  const provider = getTtsProvider();
  if (!provider) {
    // No server-side TTS configured. The client falls back to the browser's
    // built-in Web Speech API, so "Read aloud" still works.
    return Response.json(
      { error: 'Server voice is not configured.', fallback: 'browser' },
      { status: 503 },
    );
  }
  if (!provider.supports(lang)) {
    // Documented limitation: Setswana voice is not available yet.
    return Response.json(
      { error: 'Voice is available in English', unsupported: true },
      { status: 415 },
    );
  }

  try {
    const { audio, contentType } = await provider.synthesize({ text: clean, language: lang });
    return new Response(audio, {
      headers: { 'content-type': contentType, 'cache-control': 'no-store' },
    });
  } catch (e) {
    console.error('[tts]', redact(e instanceof Error ? e.message : 'error'));
    // Signal the client to use its browser voice instead of showing an error.
    return Response.json(
      { error: 'Server voice is unavailable.', fallback: 'browser' },
      { status: 502 },
    );
  }
}

const hits = new Map<string, number[]>();
function allowRate(key: string, perMinute: number): boolean {
  const now = Date.now();
  const w = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (w.length >= perMinute) return false;
  w.push(now);
  hits.set(key, w);
  return true;
}
