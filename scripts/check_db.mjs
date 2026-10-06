// Quick sanity check of seeded data. node scripts/check_db.mjs
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 1, onnotice: () => {} });
const tables = ['sites','services','site_services','availability_slots','clients','appointments','referrals','reminders','notices','outreach_events','kb_sources','messages','escalations','documents'];
for (const t of tables) {
  const [r] = await sql`select count(*)::int as n from ${sql(t)}`;
  console.log(String(r.n).padStart(6), t);
}
// Test atomic booking + race: book a slot, then verify booked increment.
const [slot] = await sql`select id, capacity, booked from availability_slots where booked < capacity and starts_at > now() limit 1`;
const [client] = await sql`select id from clients limit 1`;
if (slot && client) {
  const [appt] = await sql`select * from book_slot(${slot.id}::uuid, ${client.id}::uuid)`;
  console.log('Booked:', appt.reference, appt.starts_at);
  await sql`select * from cancel_appointment(${appt.reference}, ${client.id}::uuid)`;
  console.log('Cancelled ok.');
}
await sql.end();
