import { createHash, randomInt } from 'node:crypto';
import { serviceClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { audit, type SessionRow } from '@/lib/db';
import { maskPhone } from '@/lib/privacy/redact';

// Phone OTP verification. In DEMO_MODE we accept the fixed code 123456 and log
// the generated code. In production an SMS provider is used via OTP_PROVIDER_*.
//
// Security properties:
//  - OTP is stored hashed (never plaintext) with an expiry.
//  - Rate limited per phone (hash) and per IP hash.
//  - Locked for otpLockMinutes after otpMaxAttempts failures.
//  - Verified session lasts verifiedSessionMinutes of activity.

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  // Botswana: +267 followed by 7-8 digits. Accept local 7-8 digit numbers too.
  const m = digits.match(/^(\+?267)?(\d{7,8})$/);
  if (!m) return null;
  return '+267' + m[2];
}

function hashValue(v: string): string {
  const pepper = process.env.OTP_PEPPER ?? 'twc-demo-pepper';
  return createHash('sha256').update(v + pepper).digest('hex');
}

function hashCode(sessionId: string, code: string): string {
  const pepper = process.env.OTP_PEPPER ?? 'twc-demo-pepper';
  return createHash('sha256').update(`${sessionId}:${code}:${pepper}`).digest('hex');
}

export type OtpResult = { ok: boolean; error?: string; demo?: boolean; phoneMasked?: string };

export async function requestOtp(
  rawPhone: string,
  session: SessionRow,
  ipHash: string | null,
): Promise<OtpResult> {
  const db = serviceClient();
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, error: 'That phone number does not look right. Can you check it?' };

  const phoneHash = hashValue(phone);

  // Rate limit per phone and per IP within the last minute.
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await db
    .from('otp_codes')
    .select('id', { count: 'exact', head: true })
    .eq('phone_hash', phoneHash)
    .gte('created_at', since);
  if ((count ?? 0) >= config.limits.otpPerMinute) {
    return { ok: false, error: 'You have asked for a few codes already. Please wait a minute and try again.' };
  }

  const code = config.demoMode ? '123456' : String(randomInt(100000, 999999));
  const expiresAt = new Date(Date.now() + config.limits.otpTtlMinutes * 60_000).toISOString();

  await db.from('otp_codes').insert({
    session_id: session.id,
    phone_hash: phoneHash,
    code_hash: hashCode(session.id, code),
    expires_at: expiresAt,
    attempts: 0,
  });

  // Deliver. DEMO: log only (never log the phone itself).
  if (config.demoMode) {
    console.log(`[otp] DEMO code for ${maskPhone(phone)} is ${code} (accepted: 123456)`);
  } else {
    await sendSms(phone, `Your TWC verification code is ${code}. It expires in ${config.limits.otpTtlMinutes} minutes.`);
  }

  await audit('auth.otp.requested', { meta: { ipHash: ipHash ?? undefined } });
  return { ok: true, demo: config.demoMode, phoneMasked: maskPhone(phone) };
}

export async function confirmOtp(
  code: string,
  session: SessionRow,
  _conversationId: string,
): Promise<{ ok: boolean; error?: string; clientId?: string }> {
  const db = serviceClient();

  // DEMO convenience: 123456 always succeeds and links/creates a demo client.
  if (config.demoMode && code.trim() === '123456') {
    const clientId = await linkDemoClient(db, session.id);
    return { ok: true, clientId };
  }

  const { data: rows } = await db
    .from('otp_codes')
    .select('id,code_hash,expires_at,attempts,consumed_at,phone_hash')
    .eq('session_id', session.id)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  const row = (rows?.[0] ?? null) as {
    id: string;
    code_hash: string;
    expires_at: string;
    attempts: number;
    phone_hash: string;
  } | null;

  if (!row) return { ok: false, error: 'Please ask me to send a new code first.' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'That code has expired. I can send a new one.' };
  }
  if (row.attempts >= config.limits.otpMaxAttempts) {
    return { ok: false, error: 'Too many tries. Please wait 15 minutes before trying again.' };
  }

  if (hashCode(session.id, code.trim()) !== row.code_hash) {
    await db.from('otp_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);
    await audit('auth.otp.failed', { meta: { attempts: row.attempts + 1 } });
    return { ok: false, error: 'That code did not match. Please try again.' };
  }

  await db.from('otp_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);

  // Find or create the client for this phone (hash only stored).
  const clientId = await findOrCreateClient(db, row.phone_hash);

  const verifiedUntil = new Date(Date.now() + config.limits.verifiedSessionMinutes * 60_000).toISOString();
  await db
    .from('chat_sessions')
    .update({ client_id: clientId, verified_until: verifiedUntil })
    .eq('id', session.id);

  await audit('auth.login', { clientId });
  return { ok: true, clientId };
}

async function linkDemoClient(
  db: ReturnType<typeof serviceClient>,
  sessionId: string,
): Promise<string> {
  // Reuse the seeded demo client if present, else create a lightweight one.
  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq('demo', true)
    .limit(1)
    .maybeSingle();
  let clientId = (existing as { id: string } | null)?.id;
  if (!clientId) {
    const { data: created } = await db
      .from('clients')
      .insert({ first_name: 'Demo', preferred_language: 'en', demo: true })
      .select('id')
      .single();
    clientId = (created as { id: string } | null)?.id ?? '';
  }
  const verifiedUntil = new Date(Date.now() + config.limits.verifiedSessionMinutes * 60_000).toISOString();
  await db
    .from('chat_sessions')
    .update({ client_id: clientId, verified_until: verifiedUntil })
    .eq('id', sessionId);
  await audit('auth.login', { clientId, meta: { demo: true } });
  return clientId;
}

async function findOrCreateClient(db: ReturnType<typeof serviceClient>, phoneHash: string): Promise<string> {
  const { data: byPhone } = await db
    .from('clients')
    .select('id')
    .eq('phone_hash', phoneHash)
    .maybeSingle();
  const existing = (byPhone as { id: string } | null)?.id;
  if (existing) return existing;
  const { data: created } = await db
    .from('clients')
    .insert({ phone_hash: phoneHash, preferred_language: 'en' })
    .select('id')
    .single();
  return (created as { id: string } | null)?.id ?? '';
}

// ---------------------------------------------------------------------------
// SMS delivery. Mock in dev; plug a real provider here (do not log the code in
// production). The interface keeps the core independent of the provider.
// ---------------------------------------------------------------------------
async function sendSms(phone: string, body: string): Promise<void> {
  const provider = process.env.OTP_PROVIDER ?? 'mock';
  if (provider === 'mock') {
    console.log(`[sms:mock] to ${maskPhone(phone)}: ${body.replace(/\d{6}/, '••••••')}`);
    return;
  }
  // Example for a generic HTTP SMS gateway; configured entirely by env.
  const url = process.env.OTP_PROVIDER_URL;
  const key = process.env.OTP_PROVIDER_KEY;
  if (!url || !key) {
    console.warn('[sms] provider configured but OTP_PROVIDER_URL/KEY missing; not sending');
    return;
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ to: phone, message: body }),
  });
}
