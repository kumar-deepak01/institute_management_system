require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

async function verifySchema() {
  if (!process.env.DATABASE_URL) {
    console.error('Schema verification failed: DATABASE_URL is not configured.');
    process.exitCode = 1;
    return;
  }
  const fieldMap = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'docs', 'FIELD_MAP.json'), 'utf8'));
  const expectedTables = Object.keys(fieldMap.tables || {});
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await client.query(
      `select table_name, column_name
       from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])`,
      [expectedTables],
    );
    const actual = new Map();
    for (const row of result.rows) {
      if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
      actual.get(row.table_name).add(row.column_name);
    }
    const missingTables = [];
    const missingColumns = [];
    for (const [table, columns] of Object.entries(fieldMap.tables)) {
      if (!actual.has(table)) {
        missingTables.push(table);
        continue;
      }
      for (const column of columns) if (!actual.get(table).has(column)) missingColumns.push(`${table}.${column}`);
    }
    for (const table of missingTables) console.error(`Missing table: ${table}`);
    for (const column of missingColumns) console.error(`Missing column: ${column}`);
    if (missingTables.length || missingColumns.length) {
      process.exitCode = 1;
      return;
    }
    console.log(`Schema verification passed (${expectedTables.length} tables).`);
  } catch {
    console.error('Schema verification failed: database connection or schema query failed. Check DATABASE_URL and database availability.');
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch { /* Connection may not have opened. */ }
  }
}

verifySchema().catch(() => {
  console.error('Schema verification failed while reading FIELD_MAP.json.');
  process.exitCode = 1;
});
