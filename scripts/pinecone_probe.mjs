// Probe Pinecone: list indexes, check target index + embed API.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const key = env.PINECONE_API_KEY;
if (!key) throw new Error('No PINECONE_API_KEY');

const headers = { 'Api-Key': key, 'X-Pinecone-API-Version': '2025-01' };

const listRes = await fetch('https://api.pinecone.io/indexes', { headers });
console.log('list indexes status:', listRes.status);
const list = await listRes.json();
console.log(JSON.stringify(list, null, 2));

const target = env.PINECONE_INDEX || 'twc-kb';
const descRes = await fetch(`https://api.pinecone.io/indexes/${target}`, { headers });
console.log(`index "${target}" status:`, descRes.status);
if (descRes.ok) console.log(JSON.stringify(await descRes.json(), null, 2));

// Probe the hosted embedding model.
try {
  const embRes = await fetch('https://api.pinecone.io/embed', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.PINECONE_EMBED_MODEL || 'multilingual-e5-large',
      inputs: [{ text: 'how do I book an HIV test' }],
      parameters: { input_type: 'query', truncate: 'END' },
    }),
  });
  console.log('embed status:', embRes.status);
  if (embRes.ok) {
    const j = await embRes.json();
    console.log('embed dim:', j.data?.[0]?.values?.length);
  } else {
    console.log('embed body:', await embRes.text());
  }
} catch (e) {
  console.log('embed error:', e.message);
}
