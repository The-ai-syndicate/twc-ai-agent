// Central runtime configuration. Server-only unless prefixed NEXT_PUBLIC_.
// Assumptions (see README): DEMO_MODE relaxes OTP to accept 123456 and logs codes.

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return v === 'true' || v === '1' || v === 'yes';
}

function int(v: string | undefined, def: number): number {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  demoMode: bool(process.env.DEMO_MODE, true),

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  },

  pinecone: {
    apiKey: process.env.PINECONE_API_KEY ?? '',
    index: process.env.PINECONE_INDEX ?? 'twc-kb',
    namespace: process.env.PINECONE_NAMESPACE ?? 'kb',
    get enabled(): boolean {
      return this.apiKey.length > 0;
    },
  },

  llm: {
    apiKey: process.env.DEEPSEEK_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.deepseek.com',
    model: process.env.LLM_MODEL ?? 'deepseek-chat',
    maxTokensPerMessage: int(process.env.LLM_MAX_TOKENS, 1024),
    maxToolRounds: int(process.env.LLM_MAX_TOOL_ROUNDS, 4),
    temperature: Number(process.env.LLM_TEMPERATURE ?? '0.3'),
  },

  voice: {
    // Provider selection: 'browser' uses the client's Web Speech API (no server call).
    // 'assemblyai' proxies to AssemblyAI (English-only; requires an account with TTS enabled).
    provider: (process.env.TTS_PROVIDER ?? 'assemblyai').toLowerCase(),
    apiKey: process.env.ASSEMBLYAI_API_KEY ?? '',
    voice: process.env.ASSEMBLYAI_TTS_VOICE ?? process.env.ASSEMBLYAI_VOICE ?? 'anna',
    get enabled(): boolean {
      // Server-side TTS is only available when a real provider + key are configured.
      return this.provider !== 'browser' && this.apiKey.length > 0;
    },
  },

  email: {
    // 'mock' logs a redacted preview (dev/default). 'resend' or a generic HTTP
    // gateway (EMAIL_PROVIDER_URL) send for real.
    provider: (process.env.EMAIL_PROVIDER ?? 'mock').toLowerCase(),
    from: process.env.EMAIL_FROM ?? 'TWC Assistant <no-reply@tebelopele.org.bw>',
    get enabled(): boolean {
      return this.provider !== 'mock';
    },
  },

  ocr: {
    apiKey: process.env.OCR_SPACE_API_KEY ?? '',
    endpoint: 'https://api.ocr.space/parse/image',
    maxBytes: int(process.env.OCR_MAX_BYTES, 2 * 1024 * 1024),
    get enabled(): boolean {
      return this.apiKey.length > 0;
    },
  },

  retention: {
    conversationsDays: int(process.env.RETENTION_CONVERSATIONS_DAYS, 90),
    documentsDays: int(process.env.RETENTION_DOCUMENTS_DAYS, 7),
    auditLogsDays: int(process.env.RETENTION_AUDIT_DAYS, 365),
  },

  limits: {
    maxMessageChars: int(process.env.MAX_MESSAGE_CHARS, 2000),
    otpTtlMinutes: int(process.env.OTP_TTL_MINUTES, 10),
    verifiedSessionMinutes: int(process.env.VERIFIED_SESSION_MINUTES, 30),
    otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 3),
    otpLockMinutes: int(process.env.OTP_LOCK_MINUTES, 15),
    chatPerMinute: int(process.env.RATE_CHAT_PER_MIN, 20),
    otpPerMinute: int(process.env.RATE_OTP_PER_MIN, 3),
  },
} as const;

export type AppConfig = typeof config;
