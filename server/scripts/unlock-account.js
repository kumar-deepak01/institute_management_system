require('dotenv').config();
const { Client } = require('pg');

function parseEmail(args) {
  if (args.length !== 2 || args[0] !== '--email' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Usage: npm run unlock:account -- --email <address>');
  }
  const email = args[1].trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

async function unlockAccount() {
  let client;
  try {
    const email = parseEmail(process.argv.slice(2));
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Database configuration is unavailable.');
    client = new Client({ connectionString });
    await client.connect();
    await client.query('begin');
    const account = await client.query('select id from public.accounts where lower(email)=$1 limit 1 for update', [email]);
    if (!account.rowCount) throw new Error('Account does not exist.');
    await client.query('delete from public.login_failures where lower(email)=$1', [email]);
    await client.query('commit');
    process.stdout.write('Failed attempts and lock cleared for the account.\n');
  } catch (error) {
    if (client) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

unlockAccount().catch(() => {
  process.stderr.write('Could not unlock account. Verify the email, database configuration, and migrations.\n');
  process.exitCode = 1;
});
