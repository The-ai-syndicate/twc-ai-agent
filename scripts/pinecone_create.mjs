// Create the twc-kb serverless index (dim 1024, cosine) if missing.
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
const name = env.PINECONE_INDEX || 'twc-kb';
const headers = { 'Api-Key': key, 'Content-Type': 'application/json', 'X-Pinecone-API-Version': '2025-01' };

const desc = await fetch(`https://api.pinecone.io/indexes/${name}`, { headers: { 'Api-Key': key, 'X-Pinecone-API-Version': '2025-01' } });
if (desc.ok) {
  console.log('Index already exists.');
} else {
  const res = await fetch('https://api.pinecone.io/indexes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name,
      dimension: 1024, // multilingual-e5-large
      metric: 'cosine',
      spec: { serverless: { cloud: 'aws', region: 'us-east-1' } },
    }),
  });
  console.log('create status:', res.status);
  console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));
}
