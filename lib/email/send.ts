// Transactional email helper. Provides a single sendEmail() the app uses for
// appointment confirmations. In dev (no provider configured, or DEMO_MODE) it
// logs a redacted preview instead of sending, so the flow is fully testable
// offline. Plug a real provider (Resend / SMTP gateway) via env without touching
// callers.

import { config } from '@/lib/config';
import { redact } from '@/lib/privacy/redact';

export type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailResult = { ok: boolean; provider: string; error?: string };

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  const provider = (process.env.EMAIL_PROVIDER ?? 'mock').toLowerCase();

  // Mock / demo: never actually send; log a redacted preview.
  if (provider === 'mock' || config.demoMode === true && provider === 'mock') {
    console.log('[email:mock]', {
      to: redactEmailForLog(input.to),
      subject: input.subject,
      preview: redact(input.text).slice(0, 240),
    });
    return { ok: true, provider: 'mock' };
  }

  if (provider === 'resend') {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      console.warn('[email] resend selected but RESEND_API_KEY/EMAIL_FROM missing; not sending');
      return { ok: false, provider, error: 'email_not_configured' };
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text, html: input.html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error('[email] resend error', res.status, redact(body).slice(0, 200));
        return { ok: false, provider, error: `http_${res.status}` };
      }
      return { ok: true, provider };
    } catch (e) {
      console.error('[email] resend threw', redact(String(e)));
      return { ok: false, provider, error: 'network' };
    }
  }

  // Generic HTTP gateway: POST { to, subject, text }.
  const url = process.env.EMAIL_PROVIDER_URL;
  const key = process.env.EMAIL_PROVIDER_KEY;
  const from = process.env.EMAIL_FROM ?? 'TWC Assistant';
  if (!url) {
    console.warn('[email] provider configured but EMAIL_PROVIDER_URL missing; not sending');
    return { ok: false, provider, error: 'email_not_configured' };
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text, html: input.html }),
    });
    return { ok: res.ok, provider, error: res.ok ? undefined : `http_${res.status}` };
  } catch (e) {
    console.error('[email] gateway threw', redact(String(e)));
    return { ok: false, provider, error: 'network' };
  }
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Keep the domain (useful for debugging) but never log the full address.
function redactEmailForLog(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '[email]';
  return `${email[0]}***${email.slice(at)}`;
}
