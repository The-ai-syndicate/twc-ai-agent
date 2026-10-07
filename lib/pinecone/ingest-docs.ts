import { Pinecone } from '@pinecone-database/pinecone';
import { serviceClient } from '@/lib/supabase/server';
import { config } from '@/lib/config';
import { audit } from '@/lib/db';
import {
  chunkText,
  documentsIndex,
  documentsNamespace,
  voyageConfigured,
  voyageEmbed,
  voyageModel,
} from '@/lib/pinecone/voyage';

// Document ingestion: PDF/TXT -> text -> chunks -> Voyage embeddings -> Pinecone.
// Documents go into a SEPARATE namespace from the approved KB so uploads never
// bleed into client health answers until a human approves them.

export type IngestSummary = {
  documentId: string;
  title: string;
  chunkCount: number;
  namespace: string;
  index: string;
  model: string;
  dim: number;
};

export type IngestError = { ok: false; error: string };

function pinecone(): Pinecone {
  if (!config.pinecone.apiKey) throw new Error('PINECONE_API_KEY is not configured');
  return new Pinecone({ apiKey: config.pinecone.apiKey });
}

export async function ensureIndex(dim: number, name = documentsIndex()): Promise<void> {
  const pc = pinecone();
  const existing = await pc.listIndexes();
  const has = existing.indexes?.some((i) => i.name === name);
  if (has) return;
  await pc.createIndex({
    name,
    dimension: dim,
    metric: 'cosine',
    spec: { serverless: { cloud: 'aws', region: process.env.PINECONE_REGION ?? 'us-east-1' } },
    waitUntilReady: true,
  });
  await audit('kb.index.created', { meta: { index: name, dim } });
}

export type DocInput = {
  title: string;
  text: string;
  clientId?: string | null;
  sourceType?: 'upload' | 'paste';
  filename?: string;
};

/**
 * Parse a PDF buffer to text. Text-native PDFs yield good text; scanned PDFs
 * yield little (the doc-upload page tells the user to prefer text PDFs / TXT).
 * Guards against magic-byte mismatches.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  // pdf-parse v2 exposes a PDFParse class (named export) rather than a default fn.
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const out = await parser.getText();
    return (out.text ?? '').replace(/\u0000/g, '').trim();
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export function extractPlainText(buf: Buffer): string {
  return buf.toString('utf8').replace(/\u0000/g, '').trim();
}

export async function ingestDocument(input: DocInput): Promise<IngestSummary | IngestError> {
  if (!voyageConfigured()) {
    return { ok: false, error: 'VOYAGE_API_KEY is not configured, so embeddings cannot be created.' };
  }
  if (!config.pinecone.apiKey) {
    return { ok: false, error: 'PINECONE_API_KEY is not configured.' };
  }

  const text = input.text.trim();
  if (text.length < 20) {
    return { ok: false, error: 'The document has too little text to index (needs at least ~20 characters).' };
  }

  const chunks = chunkText(text);
  const db = serviceClient();

  // Create the document row first so we have a stable id for vector ids.
  const { data: doc, error: docErr } = await db
    .from('kb_documents')
    .insert({
      title: input.title || input.filename || 'Untitled document',
      filename: input.filename ?? null,
      source_type: input.sourceType ?? 'upload',
      char_count: text.length,
      chunk_count: chunks.length,
      status: 'processing',
      uploaded_by: input.clientId ?? null,
    })
    .select('id')
    .single();

  if (docErr || !doc) {
    return { ok: false, error: `Could not save the document: ${docErr?.message ?? 'unknown error'}` };
  }
  const documentId = (doc as { id: string }).id;

  try {
    const { embeddings, dim } = await voyageEmbed(
      chunks.map((c) => c.text),
      'document',
    );

    // Upsert vectors into the documents namespace, metadata carries no PII.
    const ns = pinecone().index(documentsIndex()).namespace(documentsNamespace());
    const vectors = chunks.map((c, i) => ({
      id: `${documentId}#${c.index}`,
      values: embeddings[i],
      metadata: {
        document_id: documentId,
        title: input.title,
        chunk_index: c.index,
        text: c.text,
        source_type: input.sourceType ?? 'upload',
      },
    }));

    const BATCH = 100;
    for (let i = 0; i < vectors.length; i += BATCH) {
      await ns.upsert(vectors.slice(i, i + BATCH));
    }

    // Persist chunks so the admin KB page can show them without hitting Pinecone.
    await db.from('kb_chunks').insert(
      chunks.map((c) => ({
        document_id: documentId,
        chunk_index: c.index,
        text: c.text,
        embedding_model: voyageModel(),
      })),
    );

    await db
      .from('kb_documents')
      .update({ status: 'indexed', indexed_at: new Date().toISOString(), dim })
      .eq('id', documentId);

    await audit('kb.ingested', { clientId: input.clientId, entity: 'kb_document', entityId: documentId, meta: { chunks: chunks.length } });

    return {
      documentId,
      title: input.title,
      chunkCount: chunks.length,
      namespace: documentsNamespace(),
      index: documentsIndex(),
      model: voyageModel(),
      dim,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    await db.from('kb_documents').update({ status: 'failed', error: msg }).eq('id', documentId);
    return { ok: false, error: msg };
  }
}
