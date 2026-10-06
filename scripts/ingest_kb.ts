// Pinecone KB ingestion. Idempotent: same id overwrites.
//   npm run ingest:kb
// Without PINECONE_API_KEY it validates the local KB and prints a summary
// (retrieval then uses the local BM25 fallback).
import { KB_CHUNKS } from '../lib/kb/data.ts';
import { getEmbedder } from '../lib/pinecone/embeddings.ts';

async function main() {
  console.log(`KB chunks: ${KB_CHUNKS.length}`);
  const embedder = getEmbedder();
  console.log(`Embedder: ${embedder.name} (dim ${embedder.dim})`);

  // Embed a probe of all chunks to exercise the provider.
  const vectors = await embedder.embed(KB_CHUNKS.map((c) => c.text), 'passage');
  console.log(`Embedded ${vectors.length} chunks.`);

  if (!process.env.PINECONE_API_KEY) {
    console.log('\nPINECONE_API_KEY not set — skipping upsert.');
    console.log('Local BM25 retrieval will be used. Set PINECONE_API_KEY + PINECONE_INDEX to enable.');
    return;
  }

  const { Pinecone } = await import('@pinecone-database/pinecone');
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const indexName = process.env.PINECONE_INDEX || 'twc-kb';
  const ns = process.env.PINECONE_NAMESPACE || 'approved';
  const index = pc.index(indexName);
  const nsIndex = index.namespace(ns);

  const records = KB_CHUNKS.map((c, i) => ({
    id: c.id,
    values: vectors[i],
    metadata: {
      category: c.category, audience: c.audience, language: c.language,
      status: c.status, title: c.title, text: c.text,
    },
  }));

  // Upsert in batches of 50 (same id overwrites -> idempotent).
  for (let i = 0; i < records.length; i += 50) {
    await nsIndex.upsert(records.slice(i, i + 50));
    console.log(`Upserted ${Math.min(i + 50, records.length)}/${records.length}`);
  }
  console.log(`\nDone. Namespace "${ns}" in index "${indexName}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
