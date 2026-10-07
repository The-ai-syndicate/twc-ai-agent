// Applies supabase/migrations/*.sql in order, tracking applied files in _migrations.
// Usage: node --env-file=.env.local scripts/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'supabase', 'migrations');

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1, prepare: false });

async function main() {
  await sql`create table if not exists _migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;

  const applied = new Set(
    (await sql`select name from _migrations`).map((r) => r.name),
  );

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const body = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into _migrations (name) values (${file})`;
      });
      console.log(`apply  ${file}`);
    } catch (err) {
      console.error(`FAIL   ${file}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log('done');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  try { await sql.end(); } catch {}
  process.exit(1);
});
