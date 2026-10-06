// Embeddings provider.
// Primary: Pinecone-hosted multilingual-e5-large (or another multilingual model)
// so English and Setswana queries retrieve the same content.
// Fallback (no PINECONE_API_KEY): a deterministic local bag-of-words hashing
// embedder. It is NOT production quality but lets the whole system run in DEMO
// mode without any external embedding key. Retrieval then uses local cosine.

import { createHash } from 'node:crypto';

export const EMBED_DIM = 512;

export type EmbedKind = 'query' | 'passage';

export interface EmbeddingProvider {
  readonly name: string;
  readonly dim: number;
  // kind lets asymmetric embedders (e5) use "query" vs "passage" prefixes.
  embed(texts: string[], kind?: EmbedKind): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Local deterministic embedder (feature hashing over word + char trigrams).
// ---------------------------------------------------------------------------
function tokenize(text: string): string[] {
  const norm = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = norm.split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (const w of words) {
    grams.push(w);
    for (let i = 0; i < w.length - 2; i++) grams.push(w.slice(i, i + 3));
  }
  return grams;
}

function hashToIndex(token: string, dim: number): number {
  const h = createHash('sha1').update(token).digest();
  return ((h[0] << 16) | (h[1] << 8) | h[2]) % dim;
}

export const localEmbedder: EmbeddingProvider = {
  name: 'local-hash',
  dim: EMBED_DIM,
  async embed(texts) {
    return texts.map((text) => {
      const v = new Array(EMBED_DIM).fill(0);
      for (const tok of tokenize(text)) v[hashToIndex(tok, EMBED_DIM)] += 1;
      // L2 normalise
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  },
};

// ---------------------------------------------------------------------------
// Pinecone-hosted embedding via the Inference API (multilingual-e5-large).
// ---------------------------------------------------------------------------
export function pineconeEmbedder(apiKey: string, model = 'multilingual-e5-large'): EmbeddingProvider {
  return {
    name: `pinecone:${model}`,
    dim: 1024, // multilingual-e5-large output dim
    async embed(texts, kind = 'passage') {
      const res = await fetch('https://api.pinecone.io/embed', {
        method: 'POST',
        headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json', 'X-Pinecone-API-Version': '2025-01' },
        body: JSON.stringify({ model, inputs: texts.map((t) => ({ text: t })), parameters: { input_type: kind, truncate: 'END' } }),
      });
      if (!res.ok) throw new Error(`Pinecone embed ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { data: { values: number[] }[] };
      return json.data.map((d) => d.values);
    },
  };
}

export function getEmbedder(): EmbeddingProvider {
  const key = process.env.PINECONE_API_KEY;
  if (key) return pineconeEmbedder(key, process.env.PINECONE_EMBED_MODEL);
  return localEmbedder;
}
