// Race test: two simultaneous bookings for a slot with capacity 1.
// Exactly one must succeed. node scripts/race_test.mjs
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = process.env.DATABASE_URL;
const mk = () => postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const a = mk(), b = mk();

// Make a fresh capacity-1 slot.
const setup = mk();
const [slot] = await setup`
  insert into availability_slots (site_id, service_id, starts_at, ends_at, capacity, booked)
  select site_id, service_id, now() + interval '3 days', now() + interval '3 days' + interval '30 min', 1, 0
  from availability_slots limit 1 returning id`;
const clients = await setup`select id from clients limit 2`;

const tryBook = async (sql, clientId) => {
  try {
    const [r] = await sql`select * from book_slot(${slot.id}::uuid, ${clientId}::uuid)`;
    return { ok: true, ref: r.reference };
  } catch (e) {
    return { ok: false, err: e.message };
  }
};

const [r1, r2] = await Promise.all([tryBook(a, clients[0].id), tryBook(b, clients[1].id)]);
const winners = [r1, r2].filter((r) => r.ok);
console.log('Result 1:', r1);
console.log('Result 2:', r2);
console.log(winners.length === 1 ? '\nPASS: exactly one booking succeeded' : `\nFAIL: ${winners.length} succeeded`);

// cleanup
await setup`delete from appointments where slot_id = ${slot.id}`;
await setup`delete from availability_slots where id = ${slot.id}`;
await setup.end(); await a.end(); await b.end();
process.exit(winners.length === 1 ? 0 : 1);
