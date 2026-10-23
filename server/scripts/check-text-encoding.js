const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');

const targetTables = new Set([
  'students', 'staff', 'batches', 'courses', 'subjects', 'topics',
  'academic_years', 'admissions', 'accounts', 'app_records',
]);
const nameFields = /(^|_)(name|first_name|last_name|full_name|display_name)$/i;
const suspiciousPattern = `(${String.fromCharCode(0x00c3)}|${String.fromCharCode(0x00c2)}|${String.fromCharCode(0x00e2)}${String.fromCharCode(0x20ac)})`;
const safeIdentifier = value => `"${String(value).replaceAll('"', '""')}"`;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Database encoding check unavailable (DATABASE_NOT_CONFIGURED).');
    process.exitCode = 1;
    return;
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });

  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const { rows: columns } = await client.query(
      `SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, ordinal_position`,
      [[...targetTables]],
    );

    const selected = columns.filter(column => {
      if (column.table_name === 'accounts') return nameFields.test(column.column_name);
      if (column.table_name === 'app_records') return ['json', 'jsonb'].includes(column.data_type);
      return ['text', 'character varying', 'character'].includes(column.data_type);
    });

    for (const column of selected) {
      const table = `${safeIdentifier(column.table_schema)}.${safeIdentifier(column.table_name)}`;
      const field = safeIdentifier(column.column_name);
      const result = await client.query(
        `SELECT count(*)::bigint AS count FROM ${table} WHERE ${field}::text ~ $1`,
        [suspiciousPattern],
      );
      console.log(`${column.table_name}.${column.column_name} ${result.rows[0]?.count ?? '0'}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* transaction may not have started */ }
    const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
    console.error(`Database encoding check unavailable (${code}).`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(() => {
  console.error('Database encoding check unavailable (UNKNOWN).');
  process.exitCode = 1;
});
