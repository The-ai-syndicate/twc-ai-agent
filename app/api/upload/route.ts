import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { serviceClient } from '@/lib/supabase/server';
import { getSession, isVerified, audit } from '@/lib/db';
import { config } from '@/lib/config';
import { SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/upload — verified client uploads an image/PDF of their own document.
// Stores in a PRIVATE bucket with a short-lived signed URL, creates a documents
// row with delete_after, and (optionally) OCRs it. The file is never public.
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const sessionId = jar.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionId ? await getSession(sessionId) : null;

  if (!session || !isVerified(session)) {
    return Response.json({ error: 'Please verify your phone number before uploading.' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'No file provided.' }, { status: 400 });
  }

  const allowed = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
  if (!allowed.includes(file.type)) {
    return Response.json({ error: 'Please upload a JPG, PNG, PDF or TXT file.' }, { status: 415 });
  }
  if (file.size > config.ocr.maxBytes) {
    return Response.json(
      { error: `That file is too large (max ${Math.round(config.ocr.maxBytes / 1024 / 1024)}MB).` },
      { status: 413 },
    );
  }

  const db = serviceClient();
  const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  const objectPath = `${session.client_id}/${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await db.storage
    .from('documents')
    .upload(objectPath, buf, { contentType: file.type, upsert: false });
  if (upErr) {
    return Response.json({ error: 'Could not store the file. Please try again.' }, { status: 500 });
  }

  const deleteAfter = new Date(Date.now() + config.retention.documentsDays * 86_400_000).toISOString();
  const { data: doc, error: insErr } = await db
    .from('documents')
    .insert({
      client_id: session.client_id,
      storage_path: objectPath,
      mime_type: file.type,
      size_bytes: file.size,
      delete_after: deleteAfter,
      status: 'uploaded',
    })
    .select('id')
    .single();

  if (insErr || !doc) {
    await db.storage.from('documents').remove([objectPath]);
    return Response.json({ error: 'Could not save the document record.' }, { status: 500 });
  }

  await audit('document.uploaded', {
    clientId: session.client_id,
    entity: 'document',
    entityId: (doc as { id: string }).id,
    meta: { mime: file.type, bytes: file.size },
  });

  return Response.json({
    documentId: (doc as { id: string }).id,
    deleteAfter,
    message:
      'Thanks, I have your document. Would you like me to read it? I can pull out the type, facility, dates and reference numbers, but I will not interpret any results.',
  });
}

const hits = new Map<string, number[]>();
function _rate(key: string, perMinute: number): boolean {
  const now = Date.now();
  const w = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (w.length >= perMinute) return false;
  w.push(now);
  hits.set(key, w);
  return true;
}
