// Local prototype authentication service. Replace with a production auth service,
// database, HTTPS, session rotation and configured mail provider before going live.
const http = require('node:http');
const fs = require('node:fs/promises');
const fileStreams = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const storePath = path.join(root, '.local-auth-store.json');
const port = Number(process.env.PORT || process.argv[2] || 3000);
const initialPasswords = { student: 'JeemStudent@12345', parent: 'JeemParent@12345' };
const sessions = new Map();
const loginFailures = new Map();
const otpChallenges = new Map();
const otpRequests = new Map();
const registrationRollbacks = new Map();
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let accounts = [];

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const passwordHash = (password, salt) => new Promise((resolve, reject) => crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key.toString('base64'))));
const validPassword = value => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
const safeEqual = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); };

async function loadAccounts() {
  try { const parsed = JSON.parse(await fs.readFile(storePath, 'utf8')); if (Array.isArray(parsed)) accounts = parsed; }
  catch (error) { if (error.code !== 'ENOENT') console.error('Auth store could not be read.'); }
}
async function saveAccounts(next) {
  const temporary = `${storePath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
  await fs.rename(temporary, storePath);
  accounts = next;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let input = '';
  for await (const chunk of req) { input += chunk; if (input.length > 64 * 1024) throw new Error('Request too large'); }
  return input ? JSON.parse(input) : {};
}
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)cs_session=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(match[1]); return null; }
  return { ...session, token: match[1] };
}
function setSession(res, account) {
  const token = randomToken();
  sessions.set(token, { accountId: account.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000, otpVerified: false });
  res.setHeader('Set-Cookie', `cs_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
}
function accountView(account) { return { email: account.email, role: account.role, name: account.name, studentId: account.studentId, mustChangePassword: account.mustChangePassword }; }
function requestIp(req) { return req.socket.remoteAddress || 'local'; }

// Configure this single function with the approved Apps Script web app when it exists.
// No Apps Script URL is present in this project, so OTP delivery uses explicit demo mode.
async function sendOtpEmail(email, code) {
  const endpoint = process.env.GAS_MAIL_WEBAPP_URL;
  if (!endpoint) return false;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, subject: 'JEE Mentor verification code', html: `<p>Your JEE Mentor verification code is <b>${code}</b>.</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>` }) });
    return response.ok;
  } catch { return false; }
}
function pruneOtpRequests(email) {
  const recent = (otpRequests.get(email) || []).filter(stamp => stamp > Date.now() - 60 * 60 * 1000);
  otpRequests.set(email, recent); return recent;
}
async function issueOtp(email, account, purpose) {
  const requests = pruneOtpRequests(email);
  if (requests.length >= 3) return { error: 'rate' };
  const last = requests.at(-1);
  if (last && Date.now() - last < 60000) return { error: 'cooldown', seconds: Math.ceil((60000 - (Date.now() - last)) / 1000) };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = randomToken(16);
  const hash = await passwordHash(code, salt);
  const id = randomToken(24);
  otpChallenges.set(id, { email, accountId: account?.id || '', purpose, hash, salt, expiresAt: Date.now() + 10 * 60 * 1000, attempts: 0, verified: false });
  requests.push(Date.now()); otpRequests.set(email, requests);
  const mailed = await sendOtpEmail(email, code);
  return { id, ...(mailed ? { delivered: true } : { demo: true, demoOtp: code }) };
}
async function api(req, res, url) {
  let input;
  try { input = await body(req); } catch { return json(res, 400, { error: 'Invalid request body.' }); }
  const session = getSession(req);

  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    const email = normalizeEmail(input.email), parentEmail = normalizeEmail(input.parentEmail);
    const duplicate = accounts.some(account => account.email === email || (parentEmail && account.email === parentEmail));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail))) return json(res, 400, { error: 'Enter valid account email addresses.' });
    if (email === parentEmail && parentEmail) return json(res, 400, { error: 'Student and parent emails must be different.' });
    if (duplicate) return json(res, 409, { error: 'An account already exists for one of these email addresses.' });
    const records = [
      { id: randomToken(16), email, role: 'student', name: String(input.name || '').trim(), studentId: String(input.studentId || ''), mustChangePassword: true, passwordSalt: randomToken(16), passwordHash: '' },
      ...(parentEmail ? [{ id: randomToken(16), email: parentEmail, role: 'parent', name: String(input.parentName || '').trim() || 'Parent / Guardian', studentId: String(input.studentId || ''), mustChangePassword: true, passwordSalt: randomToken(16), passwordHash: '' }] : [])
    ];
    for (const account of records) account.passwordHash = await passwordHash(initialPasswords[account.role], account.passwordSalt);
    try { await saveAccounts([...accounts, ...records]); } catch { return json(res, 500, { error: 'Could not save login accounts.' }); }
    const rollbackToken = randomToken(24);
    registrationRollbacks.set(rollbackToken, { ids: records.map(account => account.id), expiresAt: Date.now() + 5 * 60 * 1000 });
    return json(res, 201, { ok: true, rollbackToken });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/rollback') {
    const rollback = registrationRollbacks.get(String(input.rollbackToken || ''));
    if (!rollback || rollback.expiresAt < Date.now()) return json(res, 404, { error: 'Rollback token is invalid or expired.' });
    registrationRollbacks.delete(String(input.rollbackToken));
    const ids = new Set(rollback.ids);
    try { await saveAccounts(accounts.filter(account => !ids.has(account.id))); return json(res, 200, { ok: true }); }
    catch { return json(res, 500, { error: 'Could not roll back uncommitted accounts.' }); }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const email = normalizeEmail(input.email), key = `${requestIp(req)}:${email}`, lock = loginFailures.get(key);
    if (lock?.until > Date.now()) return json(res, 423, { error: 'Too many failed attempts. Try again in 15 minutes.' });
    const account = accounts.find(item => item.email === email);
    const candidate = account ? await passwordHash(String(input.password || ''), account.passwordSalt) : await passwordHash(String(input.password || ''), 'invalid-account-salt');
    if (!account || !safeEqual(candidate, account.passwordHash)) {
      const failures = (lock?.count || 0) + 1;
      loginFailures.set(key, failures >= 5 ? { count: 5, until: Date.now() + 15 * 60 * 1000 } : { count: failures, until: 0 });
      return json(res, 401, { error: failures >= 5 ? 'Too many failed attempts. Try again in 15 minutes.' : 'Email or password is incorrect.' });
    }
    loginFailures.delete(key); setSession(res, account);
    return json(res, 200, { ok: true, account: accountView(account) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const account = session && accounts.find(item => item.id === session.accountId);
    return account ? json(res, 200, { account: accountView(account) }) : json(res, 401, { error: 'Sign in required.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    if (session) sessions.delete(session.token);
    res.setHeader('Set-Cookie', 'cs_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/first-otp') {
    const account = session && accounts.find(item => item.id === session.accountId);
    if (!account || !account.mustChangePassword) return json(res, 403, { error: 'Password change is not required.' });
    const result = await issueOtp(account.email, account, 'first-login');
    if (result.error === 'rate') return json(res, 429, { error: 'OTP request limit reached. Try again later.' });
    if (result.error === 'cooldown') return json(res, 429, { error: `Wait ${result.seconds} seconds before requesting another code.`, seconds: result.seconds });
    return json(res, 200, { challengeId: result.id, expiresIn: 600, ...(result.demo ? { demoMode: true, demoOtp: result.demoOtp } : { sent: true }) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/forgot') {
    const email = normalizeEmail(input.email), account = accounts.find(item => item.email === email);
    const result = await issueOtp(email, account, 'forgot-password');
    const generic = 'If this email is registered, a verification code has been sent.';
    if (result.error === 'rate') return json(res, 200, { message: generic, limited: true });
    if (result.error === 'cooldown') return json(res, 200, { message: generic, seconds: result.seconds });
    return json(res, 200, { message: generic, challengeId: result.id, expiresIn: 600, ...(result.demo && account ? { demoMode: true, demoOtp: result.demoOtp } : result.demo ? { demoMode: true } : { sent: true }) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/verify-otp') {
    const challenge = otpChallenges.get(String(input.challengeId || ''));
    if (!challenge || challenge.expiresAt < Date.now() || challenge.attempts >= 5 || challenge.verified) { if (challenge && (challenge.expiresAt < Date.now() || challenge.attempts >= 5)) otpChallenges.delete(String(input.challengeId)); return json(res, 400, { error: 'Code expired, already used, or invalid. Request a new code.' }); }
    const candidate = await passwordHash(String(input.code || ''), challenge.salt);
    if (!/^\d{6}$/.test(String(input.code || '')) || !safeEqual(candidate, challenge.hash)) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) otpChallenges.delete(String(input.challengeId));
      return json(res, 400, { error: challenge.attempts >= 5 ? 'Too many incorrect attempts. Request a new code.' : 'Incorrect code.' });
    }
    challenge.verified = true; otpChallenges.set(String(input.challengeId), challenge);
    if (challenge.purpose === 'first-login' && session) { session.otpVerified = true; sessions.set(session.token, session); }
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const account = session && accounts.find(item => item.id === session.accountId);
    const flow = otpChallenges.get(String(input.challengeId || ''));
    if (!account || !flow || flow.purpose !== 'first-login' || !flow.verified || !session.otpVerified || flow.expiresAt < Date.now()) return json(res, 403, { error: 'Verify your email code before changing the password.' });
    const next = String(input.password || '');
    if (!validPassword(next) || Object.values(initialPasswords).includes(next)) return json(res, 400, { error: 'Password does not meet the required rules.' });
    if (next !== input.confirmPassword) return json(res, 400, { error: 'Passwords do not match.' });
    const updated = accounts.map(item => item.id === account.id ? { ...item, passwordSalt: randomToken(16), passwordHash: '', mustChangePassword: false } : item);
    const target = updated.find(item => item.id === account.id); target.passwordHash = await passwordHash(next, target.passwordSalt);
    try { await saveAccounts(updated); } catch { return json(res, 500, { error: 'Could not save the new password.' }); }
    otpChallenges.delete(String(input.challengeId));
    return json(res, 200, { ok: true, account: accountView(target) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    const flow = otpChallenges.get(String(input.challengeId || ''));
    if (!flow || flow.purpose !== 'forgot-password' || !flow.verified || flow.expiresAt < Date.now() || !flow.accountId) return json(res, 400, { error: 'Verify your email code before resetting the password.' });
    const next = String(input.password || ''), account = accounts.find(item => item.id === flow.accountId);
    if (!account || account.email !== flow.email) return json(res, 400, { error: 'Request a new password reset.' });
    if (!validPassword(next) || Object.values(initialPasswords).includes(next)) return json(res, 400, { error: 'Password does not meet the required rules.' });
    if (next !== input.confirmPassword) return json(res, 400, { error: 'Passwords do not match.' });
    const updated = accounts.map(item => item.id === account.id ? { ...item, passwordSalt: randomToken(16), passwordHash: '', mustChangePassword: false } : item);
    const target = updated.find(item => item.id === account.id); target.passwordHash = await passwordHash(next, target.passwordSalt);
    try { await saveAccounts(updated); } catch { return json(res, 500, { error: 'Could not save the new password.' }); }
    for (const [id, challenge] of otpChallenges) if (challenge.email === account.email) otpChallenges.delete(id);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
    return api(req, res, url).catch(() => json(res, 500, { error: 'Authentication service error.' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    if (req.method === 'HEAD') return res.end();
    const stream = fileStreams.createReadStream(filePath);
    stream.on('error', () => { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.destroy(); });
    stream.pipe(res);
  } catch { if (!res.headersSent) { res.writeHead(404); res.end('Not found'); } else res.destroy(); }
});

loadAccounts().then(() => server.listen(port, '127.0.0.1', () => console.log(`Coach Sutra local demo: http://127.0.0.1:${port}`)));
