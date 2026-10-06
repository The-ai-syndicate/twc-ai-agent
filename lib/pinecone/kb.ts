// Knowledge base store + retrieval.
// Primary backend: Pinecone (dense multilingual vectors, metadata filters).
// Fallback backend: local lexical (BM25) over lib/kb/data.ts so the demo runs
// with no Pinecone key. Both expose the same retrieve() contract and BOTH apply
// the score threshold so empty results make the assistant say "I don't know".

import { KB_CHUNKS, type KbChunk } from '../kb/data.ts';
import { getEmbedder } from './embeddings.ts';

export interface KbMatch extends KbChunk {
  score: number;
}

export interface RetrieveOptions {
  topK?: number;
  audience?: string; // e.g. 'youth' -> also include 'all'
  threshold?: number; // below this an answer is considered "no information"
}

export const DEFAULT_THRESHOLD = 0.5;
// Pinecone-hosted e5 cosine scores are compressed into a high band (~0.75-0.9)
// regardless of relevance, so a naive 0.5 cut never filters. For that backend we
// use a calibrated absolute floor PLUS a lexical-overlap recheck (below) so an
// off-corpus question returns nothing and the assistant can say it doesn't know.
export const PINECONE_MIN_SCORE = Number(process.env.PINECONE_MIN_SCORE ?? 0.78);

// ---------------------------------------------------------------------------
// Local BM25 index (built once per process).
// ---------------------------------------------------------------------------
function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1);
}

class LocalBm25 {
  private docs: { chunk: KbChunk; tf: Map<string, number>; len: number }[];
  private df = new Map<string, number>();
  private avgLen = 0;
  private k1 = 1.5;
  private b = 0.75;

  constructor(chunks: KbChunk[]) {
    this.docs = chunks.map((chunk) => {
      const toks = tokens(chunk.title + ' ' + chunk.text + ' ' + chunk.category);
      const tf = new Map<string, number>();
      for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { chunk, tf, len: toks.length };
    });
    for (const d of this.docs) for (const t of d.tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    this.avgLen = this.docs.reduce((s, d) => s + d.len, 0) / (this.docs.length || 1);
  }

  search(query: string): KbMatch[] {
    const q = tokens(query);
    const N = this.docs.length;
    const scored = this.docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5));
        score += idf * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * (d.len / this.avgLen))));
      }
      return { ...d.chunk, score };
    });
    const max = Math.max(1e-9, ...scored.map((s) => s.score));
    // Normalise top score to ~1 so a single strong hit passes the 0.5 threshold.
    return scored.map((s) => ({ ...s, score: s.score / max }));
  }
}

let localIndex: LocalBm25 | null = null;
function getLocalIndex(): LocalBm25 {
  if (!localIndex) localIndex = new LocalBm25(KB_CHUNKS);
  return localIndex;
}

// ---------------------------------------------------------------------------
// Pinecone backend
// ---------------------------------------------------------------------------
async function pineconeRetrieve(query: string, opts: RetrieveOptions): Promise<KbMatch[]> {
  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  const index = pc.index(process.env.PINECONE_INDEX || 'twc-kb');
  const embedder = getEmbedder();
  const [vector] = await embedder.embed([query], 'query');
  const ns = process.env.PINECONE_NAMESPACE || 'approved';
  const res = await index.namespace(ns).query({
    vector,
    topK: (opts.topK ?? 5) + 2,
    includeMetadata: true,
    filter: { status: { $eq: 'approved' } },
  });
  const all = (res.matches ?? [])
    .filter((m) => (m.score ?? 0) >= PINECONE_MIN_SCORE)
    .map((m) => {
      const md = (m.metadata ?? {}) as unknown as KbChunk;
      return {
        id: m.id,
        category: md.category, audience: md.audience, language: md.language,
        status: 'approved' as const, title: md.title, text: md.text,
        score: m.score ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);

  if (all.length === 0) return [];

  // Two-tier gate. Dense e5 scores are compressed, so:
  //  - score >= HIGH  -> clearly on-topic, accept.
  //  - score in [MIN, HIGH) -> borderline, require lexical overlap with the
  //    query (English queries only). This screens off-corpus questions like
  //    "do you offer dental surgery?" which still score ~0.80.
  //  - non-English (e.g. Setswana) queries skip the lexical check, because the
  //    KB is English; we trust the multilingual vector match and let the LLM
  //    decide, so cross-lingual retrieval keeps working.
  const HIGH = Number(process.env.PINECONE_HIGH_SCORE ?? 0.85);
  const isEnglish = /^[\x00-\x7F\s]*$/.test(query);
  const qWords = distinctiveWords(query);
  const coverage = (m: KbMatch): number => {
    if (qWords.length === 0) return 1;
    const hay = (' ' + m.title + ' ' + m.text + ' ' + m.category + ' ').toLowerCase();
    return qWords.filter((w) => hay.includes(w)).length / qWords.length;
  };
  const accepted = all.filter((m) => {
    if (m.score >= HIGH) return true;
    if (!isEnglish) return m.score >= PINECONE_MIN_SCORE + 0.02;
    return coverage(m) >= 0.4;
  });
  return accepted.slice(0, opts.topK ?? 5);
}

// Words that carry topical signal; drop stopwords/filler so coverage is a
// meaningful measure of whether the query is actually about the chunk.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'are',
  'am', 'be', 'can', 'do', 'does', 'did', 'i', 'you', 'we', 'they', 'it', 'this',
  'that', 'my', 'your', 'our', 'me', 'us', 'how', 'what', 'where', 'when', 'which',
  'who', 'why', 'please', 'help', 'want', 'need', 'get', 'got', 'have', 'has',
  'with', 'about', 'any', 'there', 'here', 'offer', 'available', 'about', 'from',
]);
function distinctiveWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function audienceAllowed(chunkAudience: string, requested?: string): boolean {
  if (!requested) return true;
  if (chunkAudience === 'all') return true;
  // 'youth' queries can still see 'all'; 'men'/'women' are subsets.
  return chunkAudience === requested || (requested === 'youth' && chunkAudience === 'all');
}

// ---------------------------------------------------------------------------
// Public retrieval API (contract used by the search_knowledge tool).
// ---------------------------------------------------------------------------
export async function retrieve(query: string, opts: RetrieveOptions = {}): Promise<KbMatch[]> {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  let matches: KbMatch[];
  if (process.env.PINECONE_API_KEY) {
    matches = await pineconeRetrieve(query, opts);
  } else {
    matches = getLocalIndex()
      .search(query)
      .filter((m) => m.score >= threshold)
      .slice(0, opts.topK ?? 5);
  }
  if (opts.audience) matches = matches.filter((m) => audienceAllowed(m.audience, opts.audience));
  return matches.slice(0, opts.topK ?? 5);
}

/** Live mode for the UI banner. */
export function kbMode(): 'pinecone' | 'local' {
  return process.env.PINECONE_API_KEY ? 'pinecone' : 'local';
}
