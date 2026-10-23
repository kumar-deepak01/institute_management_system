require('dotenv').config();
const readline = require('node:readline');
const { Client } = require('pg');
const { verifyPassword } = require('../src/security/password');

function parseEmail(args) {
  if (args.length !== 2 || args[0] !== '--email' || !args[1] || args[1].startsWith('--')) {
    throw new Error('Usage: npm run check:login -- --email <address>');
  }
  const email = args[1].trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('A terminal is required to enter the password securely.'));
  }
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = '';
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();
    const cleanup = () => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Input cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u0008' || character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    input.on('data', onData);
  });
}

async function checkLogin() {
  let client;
  try {
    const email = parseEmail(process.argv.slice(2));
    const password = await askHidden('Password (input hidden): ');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Database configuration is unavailable.');
    const databaseHost = new URL(connectionString).hostname;
    client = new Client({ connectionString });
    await client.connect();
    const accountResult = await client.query(
      'select email, role, password_hash, password_salt from public.accounts where lower(email)=$1 limit 1',
      [email],
    );
    const account = accountResult.rows[0];
    const lockResult = await client.query(
      `select coalesce(sum(failed_attempts), 0)::int as failed_attempt_count,
              coalesce(bool_or(locked_until > now()), false) as currently_locked,
              max(locked_until) filter (where locked_until > now()) as locked_until
       from public.login_failures where lower(email)=$1`,
      [email],
    );
    const lock = lockResult.rows[0];
    const matches = account
      ? await verifyPassword(password, account.password_salt, account.password_hash)
      : false;

    process.stdout.write(`account exists: ${account ? 'yes' : 'no'}\n`);
    process.stdout.write(`role: ${account?.role || 'none'}\n`);
    process.stdout.write(`currently locked: ${lock.currently_locked ? 'yes' : 'no'}\n`);
    process.stdout.write(`locked until: ${lock.locked_until ? new Date(lock.locked_until).toISOString() : 'none'}\n`);
    process.stdout.write(`failed attempt count: ${lock.failed_attempt_count}\n`);
    process.stdout.write(`password matches stored hash: ${matches}\n`);
    process.stdout.write(`database host: ${databaseHost}\n`);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

checkLogin().catch(() => {
  process.stderr.write('Could not check login state. Verify the email, database configuration, and migrations.\n');
  process.exitCode = 1;
});
