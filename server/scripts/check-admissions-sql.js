const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');
const { admissionsListSql, admissionsStatsSql, admissionsBatchesSql, admissionsConfigSql, buildAdmissionsListQuery } = require('../src/services/admissionsQueries');

const safeCode = error => String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
const safeMessage = error => String(error?.message || 'Unknown database error')
  .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted connection string]')
  .replace(/\b(database_url|password|passwd|hash|cookie|authorization|secret|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
  .replace(/[\r\n\t]+/g, ' ').slice(0, 300);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('ERROR connect code=DATABASE_NOT_CONFIGURED message=DATABASE_URL is not configured');
    process.exitCode=1;
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
  const cases = [
    ['list', buildAdmissionsListQuery('smoke', 'Pending', 'sample-batch', 1, 10)],
    ['stats', { sql: admissionsStatsSql, values: [] }],
    ['batches', { sql: admissionsBatchesSql, values: [] }],
    ['settings', { sql: admissionsConfigSql, values: [] }],
  ];
  try {
    await client.connect();
    await client.query('begin read only');
    for (let index=0; index<cases.length; index+=1) {
      const [name,query]=cases[index],savepoint=`admissions_sql_${index+1}`;
      await client.query(`savepoint ${savepoint}`);
      try { await client.query(query.sql,query.values); console.log(`OK ${name}`); }
      catch(error) { console.log(`ERROR ${name} code=${safeCode(error)} message=${safeMessage(error)}`);process.exitCode=1;await client.query(`rollback to savepoint ${savepoint}`); }
      finally { await client.query(`release savepoint ${savepoint}`); }
    }
    await client.query('rollback');
  } catch(error) {
    console.log(`ERROR connect code=${safeCode(error)} message=${safeMessage(error)}`);
    process.exitCode=1;
    try { await client.query('rollback'); } catch { /* no open transaction */ }
  } finally { await client.end().catch(()=>{}); }
}

main().catch(error=>{console.log(`ERROR check code=${safeCode(error)} message=${safeMessage(error)}`);process.exitCode=1;});
