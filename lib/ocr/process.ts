import { serviceClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { audit } from '@/lib/db';

// Document processing: read an uploaded document with ocr.space, then extract a
// small set of NON-CLINICAL fields. OCR text is treated as UNTRUSTED DATA:
//  - wrapped as data when passed to the model (see the assistant prompt),
//  - stripped of control-like/instruction content here,
//  - never interpreted for clinical meaning.
//
// The model only ever sees: document type, facility, service/reason as written,
// dates, reference numbers and "what to bring". It must confirm with the user.

export type DocumentFields = {
  document_type?: string;
  facility?: string;
  service_or_reason?: string;
  dates?: string[];
  reference_numbers?: string[];
  what_to_bring?: string[];
};

export type ProcessResult =
  | { ok: true; data: { text: string; fields: DocumentFields }; fields: DocumentFields }
  | { ok: false; error: string };

const MAX_OCR_CHARS = 6000;

export async function processDocument(documentId: string, clientId: string): Promise<ProcessResult> {
  const db = serviceClient();

  // Ownership check is done by the executor via client_id, but re-assert here.
  const { data: docRow } = await db
    .from('documents')
    .select('id,client_id,storage_path,mime_type,ocr_text,status')
    .eq('id', documentId)
    .eq('client_id', clientId)
    .maybeSingle();

  const doc = docRow as
    | { id: string; client_id: string; storage_path: string; mime_type: string; ocr_text: string | null; status: string }
    | null;

  if (!doc) return { ok: false, error: 'I could not find that document on your account.' };

  let text = doc.ocr_text ?? '';

  if (!text) {
    if (!config.ocr.enabled) {
      return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
    }
    const ocr = await runOcr(doc.storage_path, doc.mime_type);
    if (!ocr.ok) return { ok: false, error: ocr.error };
    text = ocr.text;
    await db
      .from('documents')
      .update({ ocr_text: text, status: 'processed' })
      .eq('id', doc.id);
    await audit('document.processed', { clientId, entity: 'document', entityId: doc.id });
  }

  if (!text || text.trim().length < 12) {
    return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
  }

  const safeText = sanitiseOcr(text);
  const fields = extractFields(safeText);
  return { ok: true, data: { text: safeText, fields }, fields };
}

// Strip control-like content and any instruction-looking lines from OCR text so
// it can never be misread as commands. We keep the data, drop the noise.
function sanitiseOcr(raw: string): string {
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n/g, '\n')
    .slice(0, MAX_OCR_CHARS);

  const suspicious =
    /(ignore (all|previous|above) instructions|you are now|system prompt|assistant:|as an ai|disregard .*rules)/i;

  return cleaned
    .split('\n')
    .filter((line) => !suspicious.test(line))
    .join('\n')
    .trim();
}

const DATE_RE = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/gi;
const REF_RE = /\b(?:ref|reference|no|id|file)[\s:#.]*([A-Z0-9-]{4,})\b/gi;
const FACILITY_RE = /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Clinic|Hospital|Health Centre|Health Center|Wellness Centre|Wellness Center|Medical Centre|Medical Center))\b/;
const DOC_TYPE_RE =
  /\b(referral letter|referral|lab(?:oratory)? result|test result|appointment (?:card|letter|slip)|prescription|discharge summary|invoice|receipt|letter)\b/i;
const BRING_RE = /what to bring[\s:]*([^\n]+)/i;

// Extraction is deliberately shallow and non-clinical.
export function extractFields(text: string): DocumentFields {
  const fields: DocumentFields = {};

  const dt = text.match(DOC_TYPE_RE);
  if (dt) fields.document_type = titleCase(dt[1]);

  const fac = text.match(FACILITY_RE);
  if (fac) fields.facility = fac[1].trim();

  const dates = Array.from(new Set((text.match(DATE_RE) ?? []).map((d) => d.trim()))).slice(0, 4);
  if (dates.length) fields.dates = dates;

  const refs: string[] = [];
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text)) && refs.length < 4) refs.push(m[1].toUpperCase());
  if (refs.length) fields.reference_numbers = Array.from(new Set(refs));

  const bring = text.match(BRING_RE);
  if (bring) fields.what_to_bring = bring[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 6);

  // "Service/reason" is captured only as written on the document, never inferred.
  const reason = text.match(/(?:reason|service|purpose|for)[\s:]*([^\n]{3,80})/i);
  if (reason) fields.service_or_reason = reason[1].trim();

  return fields;
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

async function runOcr(
  storagePath: string,
  mimeType: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const db = serviceClient();

  // Signed, short-lived URL for ocr.space to fetch (never public).
  const { data: signed, error: signErr } = await db.storage
    .from('documents')
    .createSignedUrl(storagePath, 120);
  if (signErr || !signed?.signedUrl) return { ok: false, error: "I couldn't reach that document. Please try again." };

  const form = new FormData();
  form.append('file', signed.signedUrl);
  form.append('language', 'eng');
  form.append('OCREngine', '2');
  form.append('isTable', 'true');
  form.append('scale', 'true');
  form.append('isOverlayRequired', 'false');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(config.ocr.endpoint, {
      method: 'POST',
      headers: { apikey: config.ocr.apiKey },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
    const json = (await res.json()) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
      ParsedResults?: { ParsedText?: string }[];
    };
    if (json.IsErroredOnProcessing) {
      console.warn('[ocr] error', json.ErrorMessage);
      return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
    }
    const text = (json.ParsedResults ?? []).map((r) => r.ParsedText ?? '').join('\n').trim();
    if (!text || text.length < 12) {
      return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
    }
    void mimeType;
    return { ok: true, text };
  } catch (e) {
    console.warn('[ocr] failed', e instanceof Error ? e.message : e);
    return { ok: false, error: "I couldn't read this clearly, can you retake the photo?" };
  } finally {
    clearTimeout(timeout);
  }
}
