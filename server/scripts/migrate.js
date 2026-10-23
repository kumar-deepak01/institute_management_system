require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL in server/.env to the Supabase PostgreSQL connection string.');
  const directory = path.join(__dirname, '..', 'db', 'migrations');
  const files = (await fs.readdir(directory)).filter(name => /^\d+_[\w.-]+\.sql$/.test(name)).sort();
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [72190324]);
    await client.query('create table if not exists public.schema_migrations (version text primary key, applied_at timestamptz not null default now())');
    const applied = await client.query('select version from public.schema_migrations');
    const known = new Set(applied.rows.map(row => row.version));
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (known.has(version)) continue;
      await client.query('begin');
      try {
        await client.query(await fs.readFile(path.join(directory, file), 'utf8'));
        await client.query('insert into public.schema_migrations(version) values ($1)', [version]);
        await client.query('commit');
        console.log(`Applied migration ${version}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${version} failed: ${error.message}`);
      }
    }
    console.log('Database migrations are up to date.');
  } finally {
    try { await client.query('select pg_advisory_unlock($1)', [72190324]); } catch { /* Connection cleanup handles failed sessions. */ }
    await client.end();
  }
}

migrate().catch(error => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
