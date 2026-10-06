// Applies every supabase/migrations/*.sql file in order, tracking applied ones
// in a _migrations table. Usage: node scripts/migrate.mjs
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const envPath = join(root, '.env.local');

// Minimal .env.local loader (no dependency).
function loadEnv() {
  const txt = readFileSync(envPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL missing in .env.local');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });

const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

async function main() {
  await sql`create table if not exists _migrations (
    name text primary key, applied_at timestamptz default now())`;
  const done = new Set((await sql`select name from _migrations`).map((r) => r.name));

  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip   ${f}`);
      continue;
    }
    const body = readFileSync(join(dir, f), 'utf8');
    process.stdout.write(`apply  ${f} ... `);
    try {
      await sql.unsafe(body);
      await sql`insert into _migrations (name) values (${f})`;
      console.log('ok');
    } catch (e) {
      console.log('FAIL');
      console.error(e.message);
      await sql.end();
      process.exit(1);
    }
  }
  console.log('\nAll migrations applied.');
  await sql.end();
}

main();
