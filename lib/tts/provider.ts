import { config } from '@/lib/config';
import { forSpeech } from '@/lib/privacy/redact';

// Text-to-speech behind a provider interface so a Setswana-capable provider can
// be swapped in later without touching callers.
//
// LIMITATION (documented): AssemblyAI's TTS supports English only. Setswana
// replies are shown as text with a small note ("Voice is available in English").
// We never send names, phone numbers or reference numbers to the provider:
// forSpeech() replaces them with spoken-friendly placeholders.

export type TtsRequest = { text: string; language: 'en' | 'tn' };

export interface TtsProvider {
  readonly name: string;
  readonly languages: readonly string[];
  supports(language: string): boolean;
  synthesize(req: TtsRequest): Promise<{ audio: ArrayBuffer; contentType: string }>;
}

// ---------------------------------------------------------------------------
// AssemblyAI TTS (English only). Server-side proxy; the key never leaves here.
// ---------------------------------------------------------------------------
export function assemblyTts(apiKey: string): TtsProvider {
  return {
    name: 'assemblyai',
    languages: ['en'] as const,
    supports(language: string) {
      return language === 'en';
    },
    async synthesize({ text }: TtsRequest) {
      const spoken = forSpeech(text).slice(0, 1200);
      const res = await fetch('https://api.assemblyai.com/v2/tts', {
        method: 'POST',
        headers: { authorization: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: spoken, voice: config.voice.voice }),
      });
      if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
      const audio = await res.arrayBuffer();
      return { audio, contentType: res.headers.get('content-type') ?? 'audio/mpeg' };
    },
  };
}

export function getTtsProvider(): TtsProvider | null {
  if (!config.voice.enabled) return null;
  return assemblyTts(config.voice.apiKey);
}
