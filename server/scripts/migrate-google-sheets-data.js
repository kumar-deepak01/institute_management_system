require('dotenv').config();
const { Pool } = require('pg');
const sheetsStore = require('../src/services/googleSheets');
const postgresStore = require('../src/services/postgresStore');

async function migrateSheetsData() {
  const replace = process.argv.includes('--replace');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in server/.env.');
    const existing = await pool.query('select count(*)::int as count from public.app_records');
    if (existing.rows[0].count && !replace) throw new Error('PostgreSQL already contains application records. Use --replace only after confirming a fresh Sheets import should replace them.');
    const snapshots = [];
    for (const tab of sheetsStore.SHEET_NAMES) snapshots.push([tab, await sheetsStore.getSheetRecords(tab)]);
    for (const [tab, records] of snapshots) {
      await postgresStore.saveSheetRecords(tab, records);
      console.log(`Imported ${records.length} records from ${tab}.`);
    }
    console.log('Google Sheets data import completed. No record contents or credentials were printed.');
  } finally {
    await pool.end();
    await postgresStore.closePool();
  }
}

migrateSheetsData().catch(error => {
  console.error(`Google Sheets import failed: ${error.message}`);
  process.exitCode = 1;
});
