require('dotenv').config();
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Client } = require('pg');
const { passwordHash } = require('../src/security/password');

const normalizeEmail = value => String(value || '').trim().toLowerCase();
function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const match = args[index].match(/^--(email|name|password)(?:=(.*))?$/);
    if (!match) throw new Error('Use --email, --name, and --password options, or omit fields to enter them interactively.');
    const key = match[1];
    const value = match[2] === undefined ? args[++index] : match[2];
    if (value === undefined || value.startsWith('--')) throw new Error(`A value is required for --${key}.`);
    values[key] = value;
  }
  return values;
}

function ask(question) {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => terminal.question(question, answer => {
    terminal.close();
    resolve(answer);
  }));
}

function askHidden(question) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return ask(question);
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

async function createAdmin() {
  const values = parseArgs(process.argv.slice(2));
  const email = normalizeEmail(values.email ?? await ask('Admin email: '));
  const name = String(values.name ?? await ask('Admin name: ')).trim();
  const password = String(values.password ?? await askHidden('Admin password (input hidden): '));

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (!name) throw new Error('Name is required.');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured. Set it in server/.env.');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
  } catch {
    throw new Error('Could not connect to the database. Check DATABASE_URL and database availability.');
  }
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);

    const storedRecord = await client.query(
      `select record_id, record_json from public.app_records
       where source_tab = 'Students' and record_json->>'_type' = 'account'
         and lower(record_json->>'email') = $1
       limit 1 for update`, [email],
    );
    const storedAccount = await client.query(
      'select id, email, role, name, student_id, must_change_password from public.accounts where lower(email) = $1 limit 1 for update',
      [email],
    );
    const oldRecord = storedRecord.rows[0]?.record_json || {};
    const oldAccount = storedAccount.rows[0];
    const id = String(oldRecord.id || storedRecord.rows[0]?.record_id || oldAccount?.id || crypto.randomUUID());
    const salt = crypto.randomBytes(16).toString('base64url');
    const record = {
      ...oldRecord,
      id,
      _type: 'account',
      email,
      role: 'admin',
      name,
      studentId: oldRecord.studentId || oldAccount?.student_id || '',
      passwordSalt: salt,
      passwordHash: await passwordHash(password, salt),
      mustChangePassword: false,
    };

    await client.query(
      `insert into public.app_records (source_tab, record_id, record_json)
       values ('Students', $1, $2::jsonb)
       on conflict (source_tab, record_id) do update set record_json = excluded.record_json, updated_at = now()`,
      [id, JSON.stringify(record)],
    );
    await client.query(
      `insert into public.accounts (id, email, role, name, student_id, password_hash, password_salt, must_change_password, record_json)
       values ($1, $2, 'admin', $3, $4, $5, $6, false, $7::jsonb)
       on conflict (id) do update set email = excluded.email, role = excluded.role, name = excluded.name,
         student_id = excluded.student_id, password_hash = excluded.password_hash, password_salt = excluded.password_salt,
         must_change_password = false, record_json = excluded.record_json, updated_at = now()`,
      [id, email, name, record.studentId || null, record.passwordHash, salt, JSON.stringify(record)],
    );
    await client.query('delete from public.login_failures where lower(email) = $1', [email]);
    await client.query('commit');
    process.stdout.write('Admin account created or updated successfully.\n');
  } catch (error) {
    try { await client.query('rollback'); } catch { /* Keep the original failure generic. */ }
    if (error.code === '42P01' || error.code === '42703') throw new Error('Required database tables are missing. Run npm run migrate first.');
    if (error.code === '23505') throw new Error('An account with this email could not be updated because of a database uniqueness conflict.');
    throw new Error('Could not create or update the admin account. Check the database connection and schema.');
  } finally {
    await client.end();
  }
}

createAdmin().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
