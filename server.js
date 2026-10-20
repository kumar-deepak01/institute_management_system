// Local prototype authentication service. Replace with a production auth service,
// database, HTTPS, session rotation and configured mail provider before going live.
const http = require('node:http');
const fs = require('node:fs/promises');
const fileStreams = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');

const root = __dirname;
const storePath = path.join(root, '.local-auth-store.json');
const legacyAdmissionsPath = path.join(root, '.local-admissions-store.json');
const admissionsDirectory = path.join(root, 'data');
const admissionsPath = path.join(admissionsDirectory, 'admissions.xlsx');
const admissionPhotosPath = path.join(root, 'uploads', 'admissions');
const requestedPort = Number(process.env.PORT || process.argv[2] || 3000);
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://institutemanagementsystem-lake.vercel.app').split(',').map(origin => origin.trim().replace(/\/+$/, '')).filter(Boolean));
const initialPasswords = { student: 'JeemStudent@12345', parent: 'JeemParent@12345' };
const sessions = new Map();
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
const admissionAdminToken = randomToken();
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
const admissionHeaders = ['App No', 'Applied At', 'Status', 'Full Name', 'Gender', 'Date of Birth', 'Batch Id', 'Batch Name', 'Mobile', 'Email', 'Address', 'Photo File', 'Father Name', 'Mother Name', 'Guardian Phone', 'Previous School', 'Last Year %', 'Declaration Accepted At', 'Reject Reason', 'Admin Notes', 'Status History', 'Student Id'];
const friendlyAdmissionsFileError = 'Admissions file is open in Excel. Close it and try again.';
function withAdmissionsQueue(task) { const result = admissionsQueue.then(task, task); admissionsQueue = result.catch(() => {}); return result; }
function workbookError(error) { return ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error?.code) ? friendlyAdmissionsFileError : 'Could not read or save admissions.xlsx. Please try again.'; }
function isAdmissionsFileLocked(error) { return ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error?.code); }
function newAdmissionsWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Admissions'); sheet.addRow(admissionHeaders); sheet.getRow(1).font = { bold: true };
  const settings = workbook.addWorksheet('Settings'); settings.addRow(['Key', 'Value']); settings.getRow(1).font = { bold: true };
  return workbook;
}
function parseHistory(value) { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function excelText(value) { return value && typeof value === 'object' && 'text' in value ? String(value.text) : String(value ?? ''); }
function rowApplication(row) {
  const rawPercent = row.getCell(17).value;
  const appNo = excelText(row.getCell(1).value);
  const studentId = excelText(row.getCell(22).value);
  return { id: appNo, applicationNo: appNo, appliedAt: excelText(row.getCell(2).value), status: excelText(row.getCell(3).value) || 'Pending', name: excelText(row.getCell(4).value), gender: excelText(row.getCell(5).value), dateOfBirth: excelText(row.getCell(6).value), batchId: excelText(row.getCell(7).value), batchName: excelText(row.getCell(8).value), mobile: excelText(row.getCell(9).value), email: excelText(row.getCell(10).value), address: excelText(row.getCell(11).value), photoFile: excelText(row.getCell(12).value), fatherName: excelText(row.getCell(13).value), motherName: excelText(row.getCell(14).value), guardianPhone: excelText(row.getCell(15).value), previousSchool: excelText(row.getCell(16).value), previousYearPercent: rawPercent === null || rawPercent === undefined || rawPercent === '' ? '' : Number(rawPercent), declaration: true, declarationAcceptedAt: excelText(row.getCell(18).value), rejectReason: excelText(row.getCell(19).value), adminNotes: excelText(row.getCell(20).value), statusHistory: parseHistory(row.getCell(21).value), ...(studentId ? { student: { id: studentId } } : {}) };
}
function applicationRow(item) { return [item.applicationNo, item.appliedAt, item.status, item.name, item.gender, item.dateOfBirth, item.batchId, item.batchName, item.mobile, item.email, item.address, item.photoFile || '', item.fatherName, item.motherName, item.guardianPhone, item.previousSchool, item.previousYearPercent === '' ? '' : Number(item.previousYearPercent), item.declarationAcceptedAt, item.rejectReason || '', item.adminNotes || '', JSON.stringify(item.statusHistory || []), item.student?.id || item.studentId || '']; }
function saveApplicationRow(sheet, rowNumber, item) { applicationRow(item).forEach((value, index) => { sheet.getRow(rowNumber).getCell(index + 1).value = value; }); }
function workbookSettings(workbook) {
  const sheet = workbook.getWorksheet('Settings'); if (!sheet) return admissionConfig;
  const saved = {};
  sheet.eachRow((row, rowNumber) => { if (rowNumber > 1) saved[excelText(row.getCell(1).value)] = excelText(row.getCell(2).value); });
  try { if (saved.batches) admissionConfig.batches = JSON.parse(saved.batches); } catch { /* Use current batch defaults. */ }
  admissionConfig = { ...admissionConfig, open: saved.open === undefined ? admissionConfig.open : saved.open === 'true', instituteName: saved.instituteName || admissionConfig.instituteName, academicYear: saved.academicYear || admissionConfig.academicYear };
  return admissionConfig;
}
function saveWorkbookSettings(workbook, config) {
  const sheet = workbook.getWorksheet('Settings') || workbook.addWorksheet('Settings');
  sheet.spliceRows(1, sheet.rowCount); sheet.addRow(['Key', 'Value']);
  for (const [key, value] of Object.entries({ open: String(config.open), instituteName: config.instituteName, academicYear: config.academicYear, batches: JSON.stringify(config.batches) })) sheet.addRow([key, value]);
}
async function readAdmissionsWorkbook() { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(admissionsPath); return workbook; }
async function writeAdmissionsWorkbook(workbook) {
  const temporary = `${admissionsPath}.tmp`;
  try { await workbook.xlsx.writeFile(temporary); await fs.rename(temporary, admissionsPath); }
  catch (error) { try { await fs.rm(temporary, { force: true }); } catch { /* Preserve the existing workbook. */ } throw error; }
}
async function readApplications(workbook, includePhotos = false) {
  const sheet = workbook.getWorksheet('Admissions'); if (!sheet) throw new Error('Admissions worksheet is missing.');
  const items = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber); if (!excelText(row.getCell(1).value)) continue;
    const item = rowApplication(row);
    if (includePhotos && item.photoFile) {
      try { const photo = await fs.readFile(path.join(admissionPhotosPath, path.basename(item.photoFile))); const extension = path.extname(item.photoFile).slice(1); const mime = extension === 'jpg' ? 'jpeg' : extension; item.photo = `data:image/${mime};base64,${photo.toString('base64')}`; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    items.push(item);
  }
  return items;
}
async function migrateLegacyAdmissions(workbook) {
  let legacy;
  try { legacy = JSON.parse(await fs.readFile(legacyAdmissionsPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') console.error('Legacy admissions data could not be read.'); return; }
  if (!legacy || typeof legacy !== 'object') return;
  admissionConfig = { ...admissionConfig, open: legacy.institute?.open !== false, instituteName: cleanText(legacy.institute?.name || admissionConfig.instituteName, 160), academicYear: cleanText(legacy.academicYear || admissionConfig.academicYear, 30), batches: Array.isArray(legacy.batches) ? legacy.batches : admissionConfig.batches };
  const sheet = workbook.getWorksheet('Admissions');
  for (const [index, old] of (Array.isArray(legacy.applications) ? legacy.applications : []).entries()) {
    const appNo = cleanText(old.applicationNo || `APP-${new Date().getFullYear()}-${String(index + 1).padStart(5, '0')}`, 40);
    let photoFile = '';
    if (typeof old.photo === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(old.photo)) {
      const extension = old.photo.startsWith('data:image/png;') ? 'png' : old.photo.startsWith('data:image/webp;') ? 'webp' : 'jpg';
      photoFile = `${appNo}.${extension}`; await fs.mkdir(admissionPhotosPath, { recursive: true }); await fs.writeFile(path.join(admissionPhotosPath, photoFile), Buffer.from(old.photo.split(',')[1], 'base64'));
    }
    const migrated = { ...old, id: appNo, applicationNo: appNo, appliedAt: old.appliedAt || new Date().toISOString(), status: old.status || 'Pending', photoFile, studentId: old.student?.id || old.studentId || '' };
    saveApplicationRow(sheet, sheet.rowCount + 1, migrated);
  }
  saveWorkbookSettings(workbook, admissionConfig);
}
async function loadAdmissions() {
  await fs.mkdir(admissionsDirectory, { recursive: true }); await fs.mkdir(admissionPhotosPath, { recursive: true });
  let workbook;
  try { workbook = await readAdmissionsWorkbook(); }
  catch (error) {
    if (isAdmissionsFileLocked(error)) { console.error(friendlyAdmissionsFileError); return; }
    if (error.code !== 'ENOENT' && !String(error.message).startsWith('File not found:')) throw new Error(workbookError(error));
    workbook = newAdmissionsWorkbook(); await migrateLegacyAdmissions(workbook); saveWorkbookSettings(workbook, admissionConfig); await writeAdmissionsWorkbook(workbook);
  }
  if (!workbook.getWorksheet('Admissions')) { const sheet = workbook.addWorksheet('Admissions'); sheet.addRow(admissionHeaders); await writeAdmissionsWorkbook(workbook); }
  workbookSettings(workbook);
}
const cleanText = (value, limit = 500) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
const publicApplication = item => { const { id, applicationNo, name, email, mobile, batchId, batchName, previousYearPercent, status, appliedAt } = item; return { id, applicationNo, name, email, mobile, batchId, batchName, previousYearPercent, status, appliedAt }; };
function allowApplicationRequest(req) {
  const key = requestIp(req), recent = (admissionRequests.get(key) || []).filter(stamp => stamp > Date.now() - 10 * 60 * 1000);
  if (recent.length >= 5) { admissionRequests.set(key, recent); return false; }
  recent.push(Date.now()); admissionRequests.set(key, recent); return true;
}
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)cs_session=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(match[1]); return null; }
  return { ...session, token: match[1] };
}
function setSession(req, res, account) {
  const token = randomToken();
  sessions.set(token, { accountId: account.id, expiresAt: Date.now() + 12 * 60 * 60 * 1000, otpVerified: false });
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
  try { input = await body(req, req.method === 'POST' && url.pathname === '/api/admissions/submit' ? 7 * 1024 * 1024 : 64 * 1024); } catch { return json(res, 400, { error: 'Invalid request body.' }); }
  const session = getSession(req);

  if (req.method === 'GET' && url.pathname === '/api/admissions/admin/token') return json(res, 200, { token: admissionAdminToken });

  if (req.method === 'GET' && url.pathname === '/api/admissions/public/config') return json(res, 200, { open: admissionConfig.open !== false, instituteName: admissionConfig.instituteName, academicYear: admissionConfig.academicYear });
  if (req.method === 'GET' && url.pathname === '/api/admissions/public/batches') return json(res, 200, admissionConfig.open !== false ? admissionConfig.batches.filter(item => item.active !== false).map(({ id, name, course }) => ({ id, name, course })) : []);

  if (req.method === 'POST' && url.pathname === '/api/admissions/submit') {
    if (!allowApplicationRequest(req)) return json(res, 429, { error: 'Too many applications from this connection. Please try again later.' });
    try {
      const result = await withAdmissionsQueue(async () => {
        const workbook = await readAdmissionsWorkbook(); workbookSettings(workbook);
        if (admissionConfig.open === false) return { status: 403, body: { error: 'Admissions are currently closed.' } };
        const batchRecord = admissionConfig.batches.find(item => item.id === cleanText(input.batchId, 120) && item.active !== false);
        const name = cleanText(input.name, 160), mobile = String(input.mobile || '').replace(/\D/g, '').slice(0, 10), email = cleanText(input.email, 200).toLowerCase();
        if (name.length < 2 || !['Male', 'Female', 'Other'].includes(input.gender) || !batchRecord || !/^\d{10}$/.test(mobile) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input.declaration !== true) return { status: 400, body: { error: 'Check the required fields and try again.' } };
        const sheet = workbook.getWorksheet('Admissions');
        const existing = await readApplications(workbook, false);
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
        const record = { applicationNo, appliedAt, status: 'Pending', name, gender: input.gender, dateOfBirth: cleanText(input.dateOfBirth, 20), batchId: batchRecord.id, batchName: cleanText(`${batchRecord.course ? `${batchRecord.course} - ` : ''}${batchRecord.name}`, 180), mobile, email, address: cleanText(input.address, 1000), photoFile, fatherName: cleanText(input.fatherName, 160), motherName: cleanText(input.motherName, 160), guardianPhone: String(input.guardianPhone || '').replace(/\D/g, '').slice(0, 10), previousSchool: cleanText(input.previousSchool, 200), previousYearPercent: input.previousYearPercent === '' ? '' : Number(input.previousYearPercent), declarationAcceptedAt: appliedAt, rejectReason: '', adminNotes: '', statusHistory: [{ status: 'Pending', at: appliedAt }] };
        if (record.previousYearPercent !== '' && (!Number.isFinite(record.previousYearPercent) || record.previousYearPercent < 0 || record.previousYearPercent > 100)) { if (photoFile) await fs.rm(path.join(admissionPhotosPath, photoFile), { force: true }); return { status: 400, body: { error: 'Last Year percentage must be between 0 and 100.' } }; }
        saveApplicationRow(sheet, sheet.rowCount + 1, record);
        try { await writeAdmissionsWorkbook(workbook); }
        catch (error) { if (photoFile) await fs.rm(path.join(admissionPhotosPath, photoFile), { force: true }).catch(() => {}); throw error; }
        return { status: 201, body: { ok: true, applicationNo, mobile, email } };
      });
      return json(res, result.status, result.body);
    } catch (error) { return json(res, ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error.code) ? 423 : 500, { error: workbookError(error) }); }
  }
  if (url.pathname.startsWith('/api/admissions/admin/')) {
    const actor = session && accounts.find(item => item.id === session.accountId);
    const suppliedToken = String(req.headers['x-admission-admin-token'] || '');
    if ((!actor || actor.role !== 'admin') && (!suppliedToken || !safeEqual(suppliedToken, admissionAdminToken))) return json(res, 403, { error: 'Administrator access is required to manage applications.' });
    if (req.method === 'GET' && url.pathname === '/api/admissions/admin/list') {
      try { const applications = await withAdmissionsQueue(async () => readApplications(await readAdmissionsWorkbook(), true)); return json(res, 200, { applications }); }
      catch (error) { return json(res, ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error.code) ? 423 : 500, { error: workbookError(error) }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admissions/admin/config') {
      try {
        await withAdmissionsQueue(async () => {
          const workbook = await readAdmissionsWorkbook(); workbookSettings(workbook);
          admissionConfig = { ...admissionConfig, open: input.open !== false, academicYear: cleanText(input.academicYear || admissionConfig.academicYear, 30), batches: Array.isArray(input.batches) ? input.batches.slice(0, 500).map(item => ({ id: cleanText(item.id, 120), name: cleanText(item.name, 160), course: cleanText(item.course, 160), active: item.active !== false })) : admissionConfig.batches };
          saveWorkbookSettings(workbook, admissionConfig); await writeAdmissionsWorkbook(workbook);
        });
        return json(res, 200, { ok: true });
      } catch (error) { return json(res, ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error.code) ? 423 : 500, { error: workbookError(error) }); }
    }
    const updateMatch = url.pathname.match(/^\/api\/admissions\/admin\/([^/]+)$/);
    if (req.method === 'POST' && updateMatch) {
      try {
        const application = await withAdmissionsQueue(async () => {
          const workbook = await readAdmissionsWorkbook(), sheet = workbook.getWorksheet('Admissions');
          let targetRow; sheet.eachRow((row, rowNumber) => { if (rowNumber > 1 && excelText(row.getCell(1).value) === updateMatch[1]) targetRow = row; });
          if (!targetRow) return { error: 'Application not found.', status: 404 };
          const target = rowApplication(targetRow);
          const status = ['Pending', 'Under Review', 'Approved', 'Rejected'].includes(input.status) ? input.status : target.status;
          if (status === 'Rejected' && !cleanText(input.rejectReason, 1000)) return { error: 'A rejection reason is required.', status: 400 };
          if (target.status === 'Approved' && status === 'Approved') return { unchanged: true, application: target };
          if (status === 'Approved' && target.status !== 'Approved' && (!input.student || typeof input.student !== 'object' || !input.student.id)) return { error: 'Student details are required for approval.', status: 400 };
          target.status = status; target.adminNotes = cleanText(input.adminNotes ?? target.adminNotes, 4000); target.rejectReason = status === 'Rejected' ? cleanText(input.rejectReason, 1000) : target.rejectReason || '';
          if (status === 'Approved') target.student = { id: cleanText(input.student.id, 120) };
          target.statusHistory.push({ status, at: new Date().toISOString(), reason: target.rejectReason || '' });
          saveApplicationRow(sheet, targetRow.number, target); await writeAdmissionsWorkbook(workbook);
          return { application: target };
        });
        if (application.error) return json(res, application.status, { error: application.error });
        return json(res, 200, { ok: true, ...application });
      } catch (error) { return json(res, ['EBUSY', 'EPERM', 'EACCES', 'ELOCKED'].includes(error.code) ? 423 : 500, { error: workbookError(error) }); }
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
    if (session) sessions.delete(session.token);
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

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (applyCors(req, res, url.pathname)) return;
  if (url.pathname === '/health') return req.method === 'GET' ? json(res, 200, { ok: true }) : json(res, 405, { error: 'Method not allowed.' });
  if (url.pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
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
  await loadAccounts();
  await loadAdmissions();
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

start().catch(error => { console.error(`Could not start My JEE Mentor: ${error.message}`); process.exitCode = 1; });
