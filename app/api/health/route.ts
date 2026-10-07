import { config } from '@/lib/config';
import { kbMode } from '@/lib/pinecone/kb';
import { voyageConfigured } from '@/lib/pinecone/voyage';

export const runtime = 'nodejs';

// GET /api/health — liveness + which optional services are configured.
// Never exposes secret values, only booleans.
export async function GET() {
  return Response.json({
    ok: true,
    time: new Date().toISOString(),
    demoMode: config.demoMode,
    services: {
      supabase: !!(config.supabase.url && config.supabase.serviceRoleKey),
      llm: !!config.llm.apiKey,
      pineconeKb: kbMode() === 'pinecone',
      voyage: voyageConfigured(),
      ocr: config.ocr.enabled,
      tts: config.voice.enabled,
    },
    retrieval: kbMode(),
  });
}
