const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');
const { smokeQueries } = require('../src/controllers/financeController');

const safeCode = error => String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
const safeMessage = error => String(error?.message || 'Unknown database error')
  .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted connection string]')
  .replace(/\b(database_url|password|passwd|hash|cookie|authorization|secret|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
  .replace(/[\r\n\t]+/g, ' ').slice(0, 240);

function cases() {
  const all = [];
  for (const [group, queries] of Object.entries(smokeQueries)) {
    queries.forEach((query, index) => {
      if (typeof query === 'string') {
        const values = group === 'structures' ? ['all'] : group === 'fees' && index === 1
          ? ['sample', '', '', '', 'all', 'all', 'all', null, null, false, 1, 0]
          : [];
        all.push([`${group} ${index + 1}`, query, values]);
      } else {
        const values = query === smokeQueries.fees[1]
          ? ['sample', '', '', '', 'all', 'all', 'all', null, null, false, 1, 0]
          : query === smokeQueries.fees[0] ? [] : query.values || [];
        all.push([`${group} ${index + 1}`, query.sql, values]);
      }
    });
  }
  return all;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('ERROR connect code=DATABASE_NOT_CONFIGURED message=DATABASE_URL is not configured');
    process.exitCode = 1;
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
  try {
    await client.connect();
    await client.query('begin read only');
    const queries = cases();
    for (let index = 0; index < queries.length; index += 1) {
      const [name, sql, values] = queries[index];
      const savepoint = `finance_sql_${index + 1}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        await client.query(sql, values);
        console.log(`OK ${name}`);
      } catch (error) {
        console.log(`ERROR ${name} code=${safeCode(error)} message=${safeMessage(error)}`);
        process.exitCode = 1;
        await client.query(`rollback to savepoint ${savepoint}`);
      } finally {
        await client.query(`release savepoint ${savepoint}`);
      }
    }
    await client.query('rollback');
  } catch (error) {
    console.log(`ERROR connect code=${safeCode(error)} message=${safeMessage(error)}`);
    process.exitCode = 1;
    try { await client.query('rollback'); } catch { /* No open transaction. */ }
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch(error => {
  console.log(`ERROR check code=${safeCode(error)} message=${safeMessage(error)}`);
  process.exitCode = 1;
});
