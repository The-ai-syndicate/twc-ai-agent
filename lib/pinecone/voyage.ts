import { config } from '@/lib/config';

// Voyage AI embeddings for the *document ingestion* pipeline (admin upload).
// This is separate from the client-facing KB embedder (Pinecone e5) so that
// uploaded documents can be embedded with a task-tuned model.
//
// Voyage is asymmetric: documents use input_type="document", queries "query".
// The dimension must match the Pinecone index the documents are stored in.

export const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

export type VoyageKind = 'document' | 'query';

export type VoyageResult = { embeddings: number[][]; dim: number; model: string };

export function voyageConfigured(): boolean {
  return (process.env.VOYAGE_API_KEY ?? '').length > 0;
}

export function voyageModel(): string {
  return process.env.VOYAGE_MODEL ?? 'voyage-law-2';
}

export function voyageDim(): number {
  const n = Number(process.env.VOYAGE_DIMENSION ?? '1024');
  return Number.isFinite(n) ? n : 1024;
}

export async function voyageEmbed(texts: string[], kind: VoyageKind = 'document'): Promise<VoyageResult> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY is not configured');

  const model = voyageModel();
  const out: number[][] = [];
  // Voyage accepts batches; keep them modest for latency and reliability.
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const res = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: batch, model, input_type: kind }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    out.push(...json.data.map((d) => d.embedding));
  }
  return { embeddings: out, dim: out[0]?.length ?? voyageDim(), model };
}

// Chunking strategy for uploaded documents: ~800 characters with ~120 overlap,
// split on paragraph/sentence boundaries where possible so chunks stay readable.
export type Chunk = { index: number; text: string };

export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): Chunk[] {
  const size = opts.size ?? 800;
  const overlap = opts.overlap ?? 120;
  const norm = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (norm.length <= size) return norm ? [{ index: 0, text: norm }] : [];

  const chunks: Chunk[] = [];
  let start = 0;
  let index = 0;
  while (start < norm.length) {
    let end = Math.min(start + size, norm.length);
    // Prefer to break on a paragraph or sentence boundary near the end.
    if (end < norm.length) {
      const slice = norm.slice(start, end);
      const brk = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
      if (brk > size * 0.5) end = start + brk + 1;
    }
    const text2 = norm.slice(start, end).trim();
    if (text2) chunks.push({ index: index++, text: text2 });
    if (end >= norm.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

// Namespace for uploaded documents (kept separate from the approved KB namespace
// so unapproved uploads never leak into client health answers).
export function documentsNamespace(): string {
  return process.env.PINECONE_DOCS_NAMESPACE ?? 'docs';
}

export function documentsIndex(): string {
  return process.env.PINECONE_DOCS_INDEX ?? config.pinecone.index;
}
