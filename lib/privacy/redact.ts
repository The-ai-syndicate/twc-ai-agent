// PII redaction for logs, analytics and stored message copies.
// Phone numbers, Omang IDs and emails must never appear in logs or analytics.

const PHONE_RE = /(?:\+?267[\s-]?)?\b\d{7,8}\b|\+?\d[\d\s-]{8,}\d/g;
const OMANG_RE = /\b\d{6}\s?\d{3}\s?\d{3}\b/g; // 9-digit Omang, loosely formatted
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g;

export function redact(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(OMANG_RE, '[id]')
    .replace(CARD_RE, '[number]')
    .replace(PHONE_RE, '[phone]');
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  const last = digits.slice(-3);
  return `•••• ••• ${last}`;
}

// Replace PII with spoken-friendly placeholders before sending to TTS.
export function forSpeech(text: string): string {
  return redact(text)
    .replace(/\[phone\]/g, 'on your screen')
    .replace(/\[email\]/g, 'on your screen')
    .replace(/\[id\]/g, 'on your screen')
    .replace(/\b(TWC|HIV|STI)\b/g, (m) => m.split('').join(' '));
}
