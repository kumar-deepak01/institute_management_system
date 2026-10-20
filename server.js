// Local prototype authentication service. Replace with a production auth service,
// database, HTTPS, session rotation and configured mail provider before going live.
const http = require('node:http');
const fs = require('node:fs/promises');
const fileStreams = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sheetsStore = require('./googleSheets');

const root = __dirname;
const admissionPhotosPath = path.join(root, 'uploads', 'admissions');
const requestedPort = Number(process.env.PORT || process.argv[2] || 3000);
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://institutemanagementsystem-lake.vercel.app').split(',').map(origin => origin.trim().replace(/\/+$/, '')).filter(Boolean));
const initialPasswords = { student: 'JeemStudent@12345', parent: 'JeemParent@12345' };
const loginFailures = new Map();
const otpChallenges = new Map();
const otpRequests = new Map();
const registrationRollbacks = new Map();
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
let accounts = [];
let admissionConfig = { open: true, instituteName: 'My JEE Mentor', academicYear: '2026-2027', batches: [{ id: 'batch-jee-a', name: 'JEE 2027 ? A', course: 'JEE Main Preparation', active: true }] };
const admissionRequests = new Map();
let admissionsQueue = Promise.resolve();

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sessionSecret = process.env.SESSION_SECRET || (process.env.VERCEL ? '' : randomToken(48));
const admissionAdminToken = process.env.ADMISSIONS_ADMIN_TOKEN || (sessionSecret ? crypto.createHmac('sha256', sessionSecret).update('admissions-admin').digest('base64url') : randomToken());
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const passwordHash = (password, salt) => new Promise((resolve, reject) => crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (error, key) => error ? reject(error) : resolve(key.toString('base64'))));
const validPassword = value => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
const safeEqual = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); };

async function loadAccounts() {
  accounts = (await sheetsStore.getSheetRecords('Students')).filter(item => item._type === 'account');
}
async function saveAccounts(next) {
  const current = await sheetsStore.getSheetRecords('Students');
  await sheetsStore.saveSheetRecords('Students', [...current.filter(item => item._type !== 'account'), ...next.map(item => ({ ...item, _type: 'account' }))]);
  accounts = next;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function isCorsResource(pathname) { return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/') || /\/(?:photo|photos|export|exports)(?:\/|$)/i.test(pathname); }
function applyCors(req, res, pathname) {
  if (!isCorsResource(pathname)) return false;
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admission-Admin-Token');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  return false;
}
async function body(req, maxSize = 64 * 1024) {
  let input = '';
  for await (const chunk of req) { input += chunk; if (Buffer.byteLength(input) > maxSize) throw new Error('Request too large'); }
  return input ? JSON.parse(input) : {};
}
const admissionConfigId = 'admission-config';
async function loadAdmissionConfig() {
  const batches = await sheetsStore.getSheetRecords('Batches');
  const saved = batches.find(item => item.id === admissionConfigId);
  if (saved) admissionConfig = { ...admissionConfig, ...saved.config };
  const configuredBatches = batches.filter(item => item._type === 'admission-batch').map(({ id, name, course, active }) => ({ id, name, course: course || '', active: active !== false }));
  if (configuredBatches.length) admissionConfig.batches = configuredBatches;
  return admissionConfig;
}
async function saveAdmissionConfig(config) {
  admissionConfig = config;
  const current = await sheetsStore.getSheetRecords('Batches');
  const batches = config.batches.map(item => ({ ...item, _type: 'admission-batch' }));
  await sheetsStore.saveSheetRecords('Batches', [...current.filter(item => item._type !== 'admission-batch' && item._type !== 'config'), { id: admissionConfigId, _type: 'config', config: { open: config.open, instituteName: config.instituteName, academicYear: config.academicYear } }, ...batches]);
}
async function listApplications(includePhotos = false) {
  const records = (await sheetsStore.getSheetRecords('Admissions')).filter(item => item._type !== 'config');
  if (includePhotos) {
    for (const item of records) if (item.photoFile) {
      try { const photo = await fs.readFile(path.join(admissionPhotosPath, path.basename(item.photoFile))); const ext = path.extname(item.photoFile).slice(1); item.photo = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${photo.toString('base64')}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return records;
}
async function saveApplication(item) {
  const records = await sheetsStore.getSheetRecords('Admissions');
  const index = records.findIndex(record => record.id === item.applicationNo);
  if (index < 0) records.push({ ...item, id: item.applicationNo }); else records[index] = { ...item, id: item.applicationNo };
  await sheetsStore.saveSheetRecords('Admissions', records);
}
const cleanText = (value, limit = 500) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
const publicApplication = item => { const { id, applicationNo, name, email, mobile, batchId, batchName, previousYearPercent, status, appliedAt } = item; return { id, applicationNo, name, email, mobile, batchId, batchName, previousYearPercent, status, appliedAt }; };
function allowApplicationRequest(req) {
  const key = requestIp(req), recent = (admissionRequests.get(key) || []).filter(stamp => stamp > Date.now() - 10 * 60 * 1000);
  if (recent.length >= 5) { admissionRequests.set(key, recent); return false; }
  recent.push(Date.now()); admissionRequests.set(key, recent); return true;
}
function getSession(req) {
  if (!sessionSecret) return null;
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)cs_session=([A-Za-z0-9_.-]+)/);
  if (!match) return null;
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.accountId || session.expiresAt < Date.now()) return null;
    return { ...session, token: match[1] };
  } catch { return null; }
}
function setSession(req, res, account) {
  const payload = Buffer.from(JSON.stringify({ accountId: account.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  const crossSite = allowedOrigins.has(req.headers.origin || '');
  res.setHeader('Set-Cookie', `cs_session=${token}; HttpOnly; SameSite=${crossSite ? 'None' : 'Strict'}; Path=/; Max-Age=43200${crossSite ? '; Secure' : ''}`);
}
function accountView(account) { return { email: account.email, role: account.role, name: account.name, studentId: account.studentId, mustChangePassword: account.mustChangePassword }; }
function requestIp(req) { return req.socket.remoteAddress || 'local'; }

// Configure this single function with the approved Apps Script web app when it exists.
// No Apps Script URL is present in this project, so OTP delivery uses explicit demo mode.
async function sendOtpEmail(email, code) {
  const endpoint = process.env.GAS_MAIL_WEBAPP_URL;
  if (!endpoint) return false;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, subject: 'My JEE Mentor verification code', html: `<p>Your My JEE Mentor verification code is <b>${code}</b>.</p><p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>` }) });
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
  try { input = await body(req, req.method === 'POST' && url.pathname === '/api/admissions/submit' ? 7 * 1024 * 1024 : 1024 * 1024); } catch { return json(res, 400, { error: 'Invalid request body.' }); }
  try { await loadAccounts(); } catch (error) { console.error('Google Sheets account read failed:', error.message); return json(res, 503, { error: error.message || 'Account storage is unavailable.' }); }
  const session = getSession(req);

  if (req.method === 'GET' && url.pathname === '/api/admissions/admin/token') return sessionSecret ? json(res, 200, { token: admissionAdminToken }) : json(res, 503, { error: 'Set SESSION_SECRET in the Vercel environment before using administrator APIs.' });

  if (req.method === 'GET' && url.pathname === '/api/admissions/public/config') { try { await loadAdmissionConfig(); return json(res, 200, { open: admissionConfig.open !== false, instituteName: admissionConfig.instituteName, academicYear: admissionConfig.academicYear }); } catch (error) { return json(res, 503, { error: error.message || 'Admission settings are unavailable.' }); } }
  if (req.method === 'GET' && url.pathname === '/api/admissions/public/batches') { try { await loadAdmissionConfig(); return json(res, 200, admissionConfig.open !== false ? admissionConfig.batches.filter(item => item.active !== false).map(({ id, name, course }) => ({ id, name, course })) : []); } catch (error) { return json(res, 503, { error: error.message || 'Admission settings are unavailable.' }); } }

  if (req.method === 'POST' && url.pathname === '/api/admissions/submit') {
    if (!allowApplicationRequest(req)) return json(res, 429, { error: 'Too many applications from this connection. Please try again later.' });
    try {
      const result = await withAdmissionsQueue(async () => {
        await loadAdmissionConfig();
        if (admissionConfig.open === false) return { status: 403, body: { error: 'Admissions are currently closed.' } };
        const batchRecord = admissionConfig.batches.find(item => item.id === cleanText(input.batchId, 120) && item.active !== false);
        const name = cleanText(input.name, 160), mobile = String(input.mobile || '').replace(/\D/g, '').slice(0, 10), email = cleanText(input.email, 200).toLowerCase();
        if (name.length < 2 || !['Male', 'Female', 'Other'].includes(input.gender) || !batchRecord || !/^\d{10}$/.test(mobile) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input.declaration !== true) return { status: 400, body: { error: 'Check the required fields and try again.' } };
        const existing = await listApplications(false);
        if (existing.some(item => item.mobile === mobile && item.batchId === batchRecord.id && ['Pending', 'Under Review', 'Approved'].includes(item.status))) return { status: 409, body: { error: 'An application for this mobile number and batch is already being processed.' } };
        const year = String(admissionConfig.academicYear || new Date().getFullYear()).match(/\d{4}/)?.[0] || String(new Date().getFullYear());
        const number = Math.max(0, ...existing.map(item => Number(String(item.applicationNo || '').match(new RegExp(`^APP-${year}-(\\d+)$`))?.[1] || 0))) + 1;
        const applicationNo = `APP-${year}-${String(number).padStart(5, '0')}`;
        const photo = String(input.photo || '');
        if (photo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > 7_000_000)) return { status: 400, body: { error: 'Photo must be a JPG, PNG or WebP image under 5 MB.' } };
        let photoFile = '';
        if (photo) {
          const extension = photo.startsWith('data:image/png;') ? 'png' : photo.startsWith('data:image/webp;') ? 'webp' : 'jpg';
          photoFile = `${applicationNo}.${extension}`; await fs.mkdir(admissionPhotosPath, { recursive: true });
          await fs.writeFile(path.join(admissionPhotosPath, photoFile), Buffer.from(photo.split(',')[1], 'base64'), { flag: 'wx' });
        }
        const appliedAt = new Date().toISOString();
        const record = { id: applicationNo, _type: 'application', applicationNo, appliedAt, status: 'Pending', name, gender: input.gender, dateOfBirth: cleanText(input.dateOfBirth, 20), batchId: batchRecord.id, batchName: cleanText(`${batchRecord.course ? `${batchRecord.course} - ` : ''}${batchRecord.name}`, 180), mobile, email, address: cleanText(input.address, 1000), photoFile, fatherName: cleanText(input.fatherName, 160), motherName: cleanText(input.motherName, 160), guardianPhone: String(input.guardianPhone || '').replace(/\D/g, '').slice(0, 10), previousSchool: cleanText(input.previousSchool, 200), previousYearPercent: input.previousYearPercent === '' ? '' : Number(input.previousYearPercent), declarationAcceptedAt: appliedAt, rejectReason: '', adminNotes: '', statusHistory: [{ status: 'Pending', at: appliedAt }] };
        if (record.previousYearPercent !== '' && (!Number.isFinite(record.previousYearPercent) || record.previousYearPercent < 0 || record.previousYearPercent > 100)) { if (photoFile) await fs.rm(path.join(admissionPhotosPath, photoFile), { force: true }); return { status: 400, body: { error: 'Last Year percentage must be between 0 and 100.' } }; }
        try { await sheetsStore.appendSheetRecord('Admissions', record); }
        catch (error) { if (photoFile) await fs.rm(path.join(admissionPhotosPath, photoFile), { force: true }).catch(() => {}); throw error; }
        return { status: 201, body: { ok: true, applicationNo, mobile, email } };
      });
      return json(res, result.status, result.body);
    } catch (error) { console.error('Admission write failed:', error.message); return json(res, 500, { error: error.message || 'Could not save the admission.' }); }
  }
  if (url.pathname.startsWith('/api/admissions/admin/')) {
    const actor = session && accounts.find(item => item.id === session.accountId);
    const suppliedToken = String(req.headers['x-admission-admin-token'] || '');
    if ((!actor || actor.role !== 'admin') && (!suppliedToken || !safeEqual(suppliedToken, admissionAdminToken))) return json(res, 403, { error: 'Administrator access is required to manage applications.' });
    if (req.method === 'GET' && url.pathname === '/api/admissions/admin/list') {
      try { return json(res, 200, { applications: await listApplications(true) }); }
      catch (error) { console.error('Admission read failed:', error.message); return json(res, 500, { error: error.message || 'Could not read admissions.' }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admissions/admin/config') {
      try {
        await loadAdmissionConfig();
        const next = { ...admissionConfig, open: input.open !== false, academicYear: cleanText(input.academicYear || admissionConfig.academicYear, 30), batches: Array.isArray(input.batches) ? input.batches.slice(0, 500).map(item => ({ id: cleanText(item.id, 120), name: cleanText(item.name, 160), course: cleanText(item.course, 160), active: item.active !== false })) : admissionConfig.batches };
        await saveAdmissionConfig(next);
        return json(res, 200, { ok: true });
      } catch (error) { console.error('Admission config write failed:', error.message); return json(res, 500, { error: error.message || 'Could not save admission settings.' }); }
    }
    const updateMatch = url.pathname.match(/^\/api\/admissions\/admin\/([^/]+)$/);
    if (req.method === 'POST' && updateMatch) {
      try {
        const applications = await listApplications(false), target = applications.find(item => item.applicationNo === updateMatch[1]);
        if (!target) return json(res, 404, { error: 'Application not found.' });
        const status = ['Pending', 'Under Review', 'Approved', 'Rejected'].includes(input.status) ? input.status : target.status;
        if (status === 'Rejected' && !cleanText(input.rejectReason, 1000)) return json(res, 400, { error: 'A rejection reason is required.' });
        if (target.status === 'Approved' && status === 'Approved') return json(res, 200, { ok: true, unchanged: true, application: target });
        if (status === 'Approved' && target.status !== 'Approved' && (!input.student || typeof input.student !== 'object' || !input.student.id)) return json(res, 400, { error: 'Student details are required for approval.' });
        target.status = status; target.adminNotes = cleanText(input.adminNotes ?? target.adminNotes, 4000); target.rejectReason = status === 'Rejected' ? cleanText(input.rejectReason, 1000) : target.rejectReason || '';
        if (status === 'Approved') target.student = { id: cleanText(input.student.id, 120) };
        target.statusHistory = [...(target.statusHistory || []), { status, at: new Date().toISOString(), reason: target.rejectReason || '' }];
        await saveApplication(target);
        return json(res, 200, { ok: true, application: target });
      } catch (error) { console.error('Admission update failed:', error.message); return json(res, 500, { error: error.message || 'Could not update the admission.' }); }
    }
    return json(res, 404, { error: 'Admission admin route not found.' });
  }
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
    if (!sessionSecret) return json(res, 503, { error: 'Set SESSION_SECRET in the Vercel environment before enabling sign-in.' });
    const email = normalizeEmail(input.email), key = `${requestIp(req)}:${email}`, lock = loginFailures.get(key);
    if (lock?.until > Date.now()) return json(res, 423, { error: 'Too many failed attempts. Try again in 15 minutes.' });
    const account = accounts.find(item => item.email === email);
    const candidate = account ? await passwordHash(String(input.password || ''), account.passwordSalt) : await passwordHash(String(input.password || ''), 'invalid-account-salt');
    if (!account || !safeEqual(candidate, account.passwordHash)) {
      const failures = (lock?.count || 0) + 1;
      loginFailures.set(key, failures >= 5 ? { count: 5, until: Date.now() + 15 * 60 * 1000 } : { count: failures, until: 0 });
      return json(res, 401, { error: failures >= 5 ? 'Too many failed attempts. Try again in 15 minutes.' : 'Email or password is incorrect.' });
    }
    loginFailures.delete(key); setSession(req, res, account);
    return json(res, 200, { ok: true, account: accountView(account) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const account = session && accounts.find(item => item.id === session.accountId);
    return account ? json(res, 200, { account: accountView(account) }) : json(res, 401, { error: 'Sign in required.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const crossSite = allowedOrigins.has(req.headers.origin || '');
    res.setHeader('Set-Cookie', `cs_session=; HttpOnly; SameSite=${crossSite ? 'None' : 'Strict'}; Path=/; Max-Age=0${crossSite ? '; Secure' : ''}`);
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
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const account = session && accounts.find(item => item.id === session.accountId);
    const flow = otpChallenges.get(String(input.challengeId || ''));
    if (!account || !flow || flow.purpose !== 'first-login' || !flow.verified || flow.accountId !== account.id || flow.expiresAt < Date.now()) return json(res, 403, { error: 'Verify your email code before changing the password.' });
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

  const dataMatch = url.pathname.match(/^\/api\/(students|staff|payroll|courses|batches|attendance|fees|payments)(?:\/([^/]+))?$/);
  if (dataMatch) {
    const actor = session && accounts.find(item => item.id === session.accountId);
    const suppliedToken = String(req.headers['x-admission-admin-token'] || '');
    if ((!actor || actor.role !== 'admin') && (!suppliedToken || !safeEqual(suppliedToken, admissionAdminToken))) return json(res, 403, { error: 'Administrator access is required to manage records.' });
    const collections = {
      students: ['Students', 'student'], staff: ['Staff', 'staff'], payroll: ['Staff', 'payroll'], courses: ['Courses', 'course'],
      batches: ['Batches', 'batch'], attendance: ['Attendance', 'attendance'], fees: ['Fees', 'fee'], payments: ['Fees', 'payment'],
    };
    const [tab, type] = collections[dataMatch[1]], recordId = dataMatch[2] ? cleanText(decodeURIComponent(dataMatch[2]), 160) : '';
    try {
      const all = await sheetsStore.getSheetRecords(tab);
      const records = all.filter(item => item._type === 'app-data' && item.collection === type);
      if (req.method === 'GET' && !recordId) return json(res, 200, { records: records.map(({ _type, collection, ...record }) => record) });
      if (req.method === 'POST' && !recordId) {
        const incoming = Array.isArray(input.records) ? input.records : [input.record || input];
        if (!incoming.length || incoming.length > 1000 || incoming.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return json(res, 400, { error: 'Provide between 1 and 1000 record objects.' });
        const additions = incoming.map(item => ({ ...item, id: cleanText(item.id || randomToken(16), 160), _type: 'app-data', collection: type }));
        if (additions.some(item => records.some(existing => existing.id === item.id))) return json(res, 409, { error: 'A record with that id already exists.' });
        await sheetsStore.saveSheetRecords(tab, [...all, ...additions]);
        return json(res, 201, { records: additions.map(({ _type, collection, ...record }) => record) });
      }
      if (recordId && req.method === 'PUT') {
        const target = records.find(item => item.id === recordId);
        if (!target) return json(res, 404, { error: 'Record not found.' });
        const replacement = { ...(input.record || input), id: recordId, _type: 'app-data', collection: type };
        await sheetsStore.saveSheetRecords(tab, all.map(item => item.id === recordId && item._type === 'app-data' && item.collection === type ? replacement : item));
        const { _type, collection, ...record } = replacement;
        return json(res, 200, { record });
      }
      if (recordId && req.method === 'DELETE') {
        const remaining = all.filter(item => !(item.id === recordId && item._type === 'app-data' && item.collection === type));
        if (remaining.length === all.length) return json(res, 404, { error: 'Record not found.' });
        await sheetsStore.saveSheetRecords(tab, remaining);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed for this records route.' });
    } catch (error) { console.error(`Google Sheets ${dataMatch[1]} request failed:`, error.message); return json(res, 503, { error: error.message || 'Google Sheets could not complete this request.' }); }
  }
  return json(res, 404, { error: 'API route not found.' });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (applyCors(req, res, url.pathname)) return;
  if (url.pathname === '/health') return req.method === 'GET' ? json(res, 200, { ok: true }) : json(res, 405, { error: 'Method not allowed.' });
  if (url.pathname.startsWith('/api/')) {
    if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
    return api(req, res, url).catch(() => json(res, 500, { error: 'Authentication service error.' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
  if (pathname === '/uploads' || pathname.startsWith('/uploads/') || pathname === '/data' || pathname.startsWith('/data/')) { res.writeHead(404); return res.end('Not found'); }
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
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function close(server) {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

async function start() {
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const isProduction = Boolean(process.env.PORT);
  const bindHost = isProduction ? '0.0.0.0' : '127.0.0.1';
  const ipv4 = http.createServer(handleRequest), ipv6 = http.createServer(handleRequest);
  try {
    await listen(ipv4, requestedPort, bindHost);
    if (!isProduction) await listen(ipv6, requestedPort, '::1');
  } catch (error) {
    await Promise.all([close(ipv4), close(ipv6)]);
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${requestedPort} is already in use, close the old server.`);
    throw error;
  }
  ipv4.on('error', error => console.error(`IPv4 listener error: ${error.message}`));
  if (!isProduction) ipv6.on('error', error => console.error(`IPv6 listener error: ${error.message}`));
  const baseUrl = String(process.env.RENDER_EXTERNAL_URL || `http://${bindHost}:${requestedPort}`).replace(/\/+$/, '');
  console.log(`Listening on: http://${bindHost}:${requestedPort}`);
  console.log(`Admin URL: ${baseUrl}/admin.html#admissions`);
  console.log(`Form URL: ${baseUrl}/form.html`);
}

if (require.main === module) start().catch(error => { console.error(`Could not start My JEE Mentor: ${error.message}`); process.exitCode = 1; });

module.exports = { handleRequest, start };
