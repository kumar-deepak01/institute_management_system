const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sheetsStore = require('../services/postgresStore');
const { passwordHash, verifyPassword } = require('../security/password');
const { sessionSecret, admissionAdminToken } = require('../config/session');
const { getSession, setSession, accountView, safeEqual, validCsrfRequest } = require('../middleware/auth');
const collections = require('../models/collections');
const { json, body } = require('../middleware/http');
const { getPhotoUrl, deletePhoto } = require('../services/photoStorage');
const { getPhotoMetadata, saveProfile } = require('../services/profileRecords');
const publicForms = require('../services/publicForms');
const { getPool } = require('../services/postgresStore');
const { handleStudentRoute } = require('./studentController');
const { handleStaffRoute } = require('./staffController');
const { route: handleFinanceRoute } = require('./financeController');
const { sendPasswordResetOtp } = require('../services/mail');
const root = path.resolve(__dirname, '../..');
const admissionPhotosPath = path.join(root, 'uploads', 'admissions');
const initialPasswords = { student: process.env.DEFAULT_STUDENT_PASSWORD, parent: process.env.DEFAULT_PARENT_PASSWORD, staff: process.env.DEFAULT_STAFF_PASSWORD };
const registrationRollbacks = new Map();
let accounts = [];
let admissionConfig = { open: true, instituteName: 'My JEE Mentor', academicYear: '2026-2027', batches: [{ id: 'batch-jee-a', name: 'JEE 2027 ? A', course: 'JEE Main Preparation', active: true }] };
const admissionRequests = new Map();
const passwordResetRate = new Map();
let admissionsQueue = Promise.resolve();

function allowPasswordResetRequest(email, ip) {
  const now=Date.now();
  for(const key of [`email:${email}`,`ip:${ip}`]) {
    const recent=(passwordResetRate.get(key)||[]).filter(stamp=>stamp>now-15*60*1000);
    if(recent.length>=3 || recent.some(stamp=>stamp>now-60*1000)) { passwordResetRate.set(key,recent); return false; }
    recent.push(now);passwordResetRate.set(key,recent);
  }
  return true;
}
function resetOtpHash(resetId,otp) { return crypto.createHmac('sha256',sessionSecret).update(`${resetId}:${otp}`).digest('hex'); }

function createConcurrencyLimiter(maxConcurrent) {
  let active = 0;
  const waiting = [];
  return task => new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        waiting.shift()?.();
      });
    };
    if (active < maxConcurrent) run();
    else waiting.push(run);
  });
}

const dashboardQueryLimit = createConcurrencyLimiter(3);
function safeDatabaseErrorMessage(error) {
  return String(error?.message || 'Unknown database error')
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted connection string]')
    .replace(/\b(database_url|password|passwd|hash|cookie|authorization)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .slice(0, 500);
}
function logDatabaseFailure(step, error, endpoint = '') {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  console.error(`[database] ${step}${endpoint ? ` endpoint=${endpoint}` : ''} failed (code=${code}): ${safeDatabaseErrorMessage(error)}`);
}
const safeDashboardRows = result => Array.isArray(result?.rows) ? result.rows : [];
const safeDashboardFirst = result => safeDashboardRows(result)[0] || {};
const normalizeDashboardResult = result => ({ rows: safeDashboardRows(result) });
function dashboardPanelName(sql) {
  const text = sql.toLowerCase();
  if (text.includes('dateofbirth') || text.includes('date_of_birth')) return text.includes('public.staff') ? 'staff birthdays' : 'student birthdays';
  if (text.includes('permanentstate')) return 'state demographics';
  if (text.includes('permanentcity')) return 'city demographics';
  if (text.includes("record_json->>'gender'")) return 'gender demographics';
  if (text.includes('application_no')) return 'recent admissions';
  if (text.includes('receipt_number')) return 'recent transactions';
  if (text.includes('generate_series') && text.includes('public.payments')) return 'fee collection chart';
  if (text.includes('generate_series')) return 'enrollment chart';
  if (text.includes('group by s.id')) return 'at-risk students';
  if (text.includes('public.assignments')) return 'active homework';
  if (text.includes('public.attendance') && text.includes('current_date')) return 'today attendance';
  if (text.includes('public.payments')) return 'fee collection';
  if (text.includes('public.fees')) return text.includes('sum(amount)') ? 'pending fees' : 'fee setup';
  const table = text.match(/\bfrom\s+public\.([a-z_]+)/)?.[1];
  return table ? `setup ${table}` : 'dashboard query';
}
function emptyDashboardPayload() {
  const labels = [
    'Set up an academic year', 'Add a course', 'Create a batch', 'Enroll your first student',
    'Record attendance', 'Record a fee payment', 'Create homework', 'Add a staff member',
    'Receive an admission', 'Add a subject', 'Add a topic', 'Create a fee record',
    'Send a broadcast', 'Review homework', 'Set up payroll', 'Set institute details',
  ];
  return {
    setup: { completed: 0, total: labels.length, steps: labels.map(label => ({ label, description: 'Dashboard data could not be assembled.', complete: false })) },
    stats: { students: 0, activeStudents: 0, attendancePresent: 0, attendanceTotal: 0, attendanceRate: null, feesCollected: 0, paymentsThisMonth: 0, pendingAdmissions: 0, staff: 0, feePending: 0, atRisk: 0 },
    enrollment: [], feeCollection: [], demographics: { gender: [], states: [], cities: [] },
    recentTransactions: [], recentAdmissions: [], studentBirthdays: [], staffBirthdays: [],
    atRiskStudents: [], activeHomework: [], todayAttendance: { total: 0, present: 0 },
    upcomingExams: [], todayClasses: [], topPerformers: [], peakMonths: [], forecast: [0, 0, 0],
  };
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const normalizeEmail = value => String(value || '').trim().toLowerCase();

async function loadAccounts() {
  accounts = (await sheetsStore.getSheetRecords('Students')).filter(item => item._type === 'account');
  if (accounts.length === 0) {
    try {
      const { rows } = await getPool().query('select record_json from public.accounts');
      if (rows && rows.length > 0) {
        accounts = rows.map(r => r.record_json).filter(Boolean);
      }
    } catch (_) {}
  }
}
async function saveAccounts(next) {
  const current = await sheetsStore.getSheetRecords('Students');
  await sheetsStore.saveSheetRecords('Students', [...current.filter(item => item._type !== 'account'), ...next.map(item => ({ ...item, _type: 'account' }))]);
  accounts = next;
}

async function changeAccountPassword(accountId, currentPassword, nextPassword) {
  await loadAccounts();
  const account = accounts.find(item => item.id === accountId);
  if (!account || !(await verifyPassword(String(currentPassword || ''), account.passwordSalt, account.passwordHash))) return null;
  if (nextPassword.length < 8 || Object.values(initialPasswords).filter(Boolean).includes(nextPassword)) {
    const error = new Error('Choose a password with at least 8 characters that differs from the initial default password.');
    error.code = 'PASSWORD_POLICY';
    throw error;
  }
  const updated = accounts.map(item => item.id === account.id ? { ...item, passwordSalt: randomToken(16), passwordHash: '', mustChangePassword: false, sessionVersion: Number(item.sessionVersion || 0) + 1 } : item);
  const target = updated.find(item => item.id === account.id);
  target.passwordHash = await passwordHash(nextPassword, target.passwordSalt);
  await saveAccounts(updated);
  return target;
}

async function resolveSessionAccount(req) {
  const session = getSession(req);
  if (!session) return null;
  await loadAccounts();
  const account=accounts.find(item => item.id === session.accountId) || null;
  return account && Number(account.sessionVersion||0)===Number(session.sessionVersion||0) ? account : null;
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
function requestIp(req) { return req.socket.remoteAddress || 'local'; }

async function api(req, res, url) {
  let input;
  try { input = req.method === 'POST' && ['/api/admin/students/import/preview','/api/admin/staff/import/preview'].includes(url.pathname) && String(req.headers['content-type']||'').toLowerCase().startsWith('multipart/form-data') ? {} : await body(req, req.method === 'POST' && url.pathname === '/api/admissions/submit' ? 7 * 1024 * 1024 : req.method === 'POST' && url.pathname === '/api/admin/finance/import' ? 3 * 1024 * 1024 : 1024 * 1024); } catch { return json(res, 400, { error: 'Invalid request body.' }); }
  const session = getSession(req);
  if (req.method === 'GET' && url.pathname === '/api/auth/csrf') return session ? json(res, 200, { csrfToken: session.csrfToken }) : json(res, 401, { error: 'Sign in required.' });
  try { await loadAccounts(); } catch (error) {
    logDatabaseFailure('account read', error);
    if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') return json(res, 500, { error: 'The administrator session could not be verified.' });
    return json(res, 503, { error: 'Account storage is unavailable. Check the database connection and server configuration.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/trial-requests') {
    const name = cleanText(input.name, 160), email = normalizeEmail(input.email), instituteName = cleanText(input.instituteName, 200), phone = cleanText(input.phone, 40);
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || instituteName.length < 2 || (phone && !/^[+\d() .-]{7,24}$/.test(phone))) return json(res, 400, { error: 'Check the trial request fields and try again.' });
    try { await publicForms.saveTrialRequest({ name, email, instituteName, phone }); return json(res, 201, { ok: true }); }
    catch { return json(res, 503, { error: 'Trial request could not be saved.' }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/newsletter') {
    const email = normalizeEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email address.' });
    try { await publicForms.saveNewsletterEmail(email); return json(res, 200, { ok: true }); }
    catch { return json(res, 503, { error: 'Newsletter signup could not be saved.' }); }
  }

  const actor = session && accounts.find(item => item.id === session.accountId);
  if (session && actor && Number(session.sessionVersion || 0) !== Number(actor.sessionVersion || 0)) return json(res, 401, { error: 'Your session has expired. Sign in again.' });
  if (req.method === 'POST' && url.pathname === '/api/auth/forgot-password') {
    const email=normalizeEmail(input.email),generic='If this email is registered, a password reset code has been sent.';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json(res,200,{message:generic});
    if(!process.env.SMTP_HOST||!process.env.SMTP_PORT||!process.env.SMTP_USER||!process.env.SMTP_PASS||!process.env.MAIL_FROM)return json(res,503,{error:'Password reset could not be sent. Contact your institute administrator.'});
    if(!allowPasswordResetRequest(email,requestIp(req)))return json(res,200,{message:generic});
    const account=accounts.find(item=>item.email===email);if(!account)return json(res,200,{message:generic});
    const resetId=randomToken(24),otp=String(crypto.randomInt(0,1000000)).padStart(6,'0');
    try {
      const pool=getPool();await pool.query("delete from public.password_resets where expires_at<now() or (used_at is not null and created_at<now()-interval '1 day')");
      await pool.query('insert into public.password_resets(id,account_id,otp_hash,expires_at) values($1,$2,$3,now()+interval \'10 minutes\')',[resetId,account.id,crypto.createHmac('sha256',sessionSecret).update(`${resetId}:${otp}`).digest('hex')]);
      await sendPasswordResetOtp(email,otp);return json(res,200,{message:generic});
    } catch(error) {
      logDatabaseFailure('password reset email delivery',error);
      try{await getPool().query('delete from public.password_resets where id=$1',[resetId]);}catch(cleanupError){logDatabaseFailure('password reset cleanup',cleanupError);}
      return json(res,503,{error:'Password reset could not be sent. Check mail service settings and try again.'});
    }
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    const email=normalizeEmail(input.email),otp=String(input.otp||''),next=String(input.newPassword||''),confirm=String(input.confirmPassword||'');
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^[0-9]{6}$/.test(otp))return json(res,400,{error:'The reset code is invalid or expired. Request a new code.'});
    if(next.length<10)return json(res,400,{error:'Choose a password with at least 10 characters.'});if(next!==confirm)return json(res,400,{error:'Passwords do not match.'});
    const client=await getPool().connect();try{await client.query('begin');const result=await client.query(`select r.id,r.otp_hash,r.expires_at,r.used_at,r.attempts,a.id account_id,a.email,a.role,a.record_json from public.password_resets r join public.accounts a on a.id=r.account_id where lower(a.email)=$1 and r.used_at is null order by r.created_at desc limit 1 for update of r,a`,[email]);
      if(!result.rowCount){await client.query('rollback');return json(res,400,{error:'The reset code is invalid or expired. Request a new code.'});}
      const row=result.rows[0];if(row.expires_at<new Date()||Number(row.attempts)>=5){await client.query('rollback');return json(res,400,{error:'The reset code is invalid or expired. Request a new code.'});}
      const candidate=crypto.createHmac('sha256',sessionSecret).update(`${row.id}:${otp}`).digest('hex');if(!safeEqual(candidate,row.otp_hash)){await client.query('update public.password_resets set attempts=attempts+1 where id=$1',[row.id]);await client.query('commit');return json(res,400,{error:'The reset code is invalid or expired. Request a new code.'});}
      const isStaff=Boolean(row.record_json?.staffId||row.record_json?.employeeId),defaultPassword=row.role==='parent'?process.env.DEFAULT_PARENT_PASSWORD:isStaff?process.env.DEFAULT_STAFF_PASSWORD:process.env.DEFAULT_STUDENT_PASSWORD;if(defaultPassword&&next===defaultPassword){await client.query('rollback');return json(res,400,{error:'Choose a password different from the initial default password.'});}
      const salt=randomToken(16),hash=await passwordHash(next,salt),version=Number(row.record_json?.sessionVersion||0)+1,updated={...row.record_json,passwordSalt:salt,passwordHash:hash,mustChangePassword:false,sessionVersion:version};
      await client.query('update public.accounts set password_hash=$2,password_salt=$3,must_change_password=false,session_version=$4,record_json=$5::jsonb,updated_at=now() where id=$1',[row.account_id,hash,salt,version,JSON.stringify(updated)]);
      await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',row.account_id,JSON.stringify({_type:'account',...updated})]);
      await client.query('update public.password_resets set used_at=now() where id=$1',[row.id]);await client.query('delete from public.login_failures where email=$1',[email]);await client.query('commit');
      return json(res,200,{ok:true});
    }catch(error){try{await client.query('rollback');}catch{}logDatabaseFailure('password reset completion',error);return json(res,500,{error:'Password reset could not be completed. Please try again.'});}finally{client.release();}
  }
  if (url.pathname.startsWith('/api/admin/staff')) return handleStaffRoute(req, res, url, input || {}, actor);
  if (url.pathname.startsWith('/api/admin/students')) return handleStudentRoute(req, res, url, input || {}, actor);
  if (url.pathname.startsWith('/api/admin/finance')) return handleFinanceRoute(req, res, url, input || {}, actor, session);
  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    if (!actor || actor.role !== 'admin') return json(res, 403, { error: 'Administrator access is required.' });
    let pool;
    try {
      pool = getPool();
    } catch (error) {
      logDatabaseFailure('pool initialization', error);
      return json(res, 200, emptyDashboardPayload());
    }
    try {
      await pool.query('select 1');
    } catch (error) {
      logDatabaseFailure('connectivity select 1', error);
      return json(res, 503, { error: 'The database connection check failed. Dashboard data is unavailable.' });
    }
    try {
      // The shared pool and a three-query process-wide limit keep dashboard refreshes within
      // the Supabase pooler's connection budget. Optional panels degrade independently.
      const dashboardQuery = (sql, values) => dashboardQueryLimit(() => pool.query(sql, values)).then(normalizeDashboardResult).catch(error => {
        logDatabaseFailure(dashboardPanelName(sql), error);
        return { rows: [] };
      });
      const projectedPaymentDate = alias => `coalesce(${alias}.paid_at, case when ${alias}.record_json->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(${alias}.record_json->>'date',10)::date::timestamptz end)`;
      const [students, activeStudents, attendance, payments, admissions, monthlyEnrollments, monthlyFees, settings, staff, pendingFees, recentTransactions, recentAdmissions, demographics, stateDemographics, cityDemographics, studentBirthdays, staffBirthdays, atRiskStudents, activeHomework, setupMetrics] = (await Promise.all([
        dashboardQuery('select count(*)::int as count from public.students'),
        dashboardQuery("select count(*)::int as count from public.students where lower(coalesce(status,'')) = 'active'"),
        dashboardQuery("select count(*)::int as total, count(*) filter (where lower(status) in ('p','present'))::int as present from public.attendance where attendance_date = current_date"),
        dashboardQuery("select coalesce(sum(amount),0)::numeric as total, count(*)::int as count from public.payments where paid_at >= date_trunc('month', current_date) and paid_at < date_trunc('month', current_date) + interval '1 month'"),
        dashboardQuery("select count(*)::int as total, count(*) filter (where lower(status) in ('pending','under review'))::int as pending from public.admissions"),
        dashboardQuery("select to_char(months.month_start, 'Mon') as label, extract(year from months.month_start)::int as year, extract(quarter from months.month_start)::int as quarter, coalesce(count(students.id),0)::int as count from generate_series(date_trunc('month', current_date) - interval '11 months', date_trunc('month', current_date), interval '1 month') as months(month_start) left join public.students on coalesce(students.joined_at, case when students.record_json->>'admissionDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(students.record_json->>'admissionDate',10)::date::timestamptz end, students.created_at) >= months.month_start and coalesce(students.joined_at, case when students.record_json->>'admissionDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(students.record_json->>'admissionDate',10)::date::timestamptz end, students.created_at) < months.month_start + interval '1 month' group by months.month_start order by months.month_start"),
        dashboardQuery(`select to_char(months.month_start, 'Mon') as label, coalesce(sum(payments.amount),0)::numeric as amount from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') as months(month_start) left join public.payments on ${projectedPaymentDate('payments')} >= months.month_start and ${projectedPaymentDate('payments')} < months.month_start + interval '1 month' group by months.month_start order by months.month_start`),
        dashboardQuery('select config, institute_name from public.institute_settings where id=$1 limit 1', ['institute-settings']),
        dashboardQuery("select count(*)::int as count from public.staff where lower(coalesce(status,'')) not in ('inactive','left','terminated')"),
        dashboardQuery("select coalesce(sum(amount),0)::numeric as total from public.fees where lower(coalesce(status,'')) in ('pending','unpaid','overdue')"),
        dashboardQuery(`select p.id, p.amount::numeric as amount, ${projectedPaymentDate('p')} as paid_at, p.status, p.receipt_number, coalesce(s.name, p.record_json->>'studentName', 'Student') as student_name, coalesce(f.description, p.record_json->>'description', 'Fee payment') as description, coalesce(p.record_json->>'method', p.record_json->>'paymentMethod', '') as method from public.payments p left join public.students s on s.id=p.student_id left join public.fees f on f.id=p.fee_id where ${projectedPaymentDate('p')} is not null order by paid_at desc limit 5`),
        dashboardQuery("select application_no, name, batch_name, status, applied_at, mobile from public.admissions order by applied_at desc limit 5"),
        dashboardQuery("select lower(coalesce(nullif(record_json->>'gender',''), 'unspecified')) as label, count(*)::int as count from public.students group by 1 order by count desc"),
        dashboardQuery("select coalesce(nullif(record_json->>'state',''), nullif(record_json->>'permanentState','')) as label, count(*)::int as count from public.students where coalesce(nullif(record_json->>'state',''), nullif(record_json->>'permanentState','')) is not null group by 1 order by count desc limit 10"),
        dashboardQuery("select coalesce(nullif(record_json->>'city',''), nullif(record_json->>'permanentCity','')) as label, count(*)::int as count from public.students where coalesce(nullif(record_json->>'city',''), nullif(record_json->>'permanentCity','')) is not null group by 1 order by count desc limit 10"),
        dashboardQuery("select id, name, right(left(coalesce(record_json->>'dateOfBirth', record_json->>'date_of_birth', ''),10),5) as birthday from public.students where right(left(coalesce(record_json->>'dateOfBirth', record_json->>'date_of_birth', ''),10),5)=to_char(current_date,'MM-DD') order by name limit 20"),
        dashboardQuery("select id, name, right(left(coalesce(record_json->>'dateOfBirth', record_json->>'date_of_birth', ''),10),5) as birthday from public.staff where right(left(coalesce(record_json->>'dateOfBirth', record_json->>'date_of_birth', ''),10),5)=to_char(current_date,'MM-DD') order by name limit 20"),
        dashboardQuery("select s.id, s.name, coalesce(s.batch_id,'') as batch, count(a.id)::int as marked, count(a.id) filter (where lower(a.status) in ('p','present'))::int as present from public.students s join public.attendance a on a.student_id in (s.id,s.student_id) and a.attendance_date >= current_date - interval '30 days' and a.attendance_date <= current_date group by s.id having count(a.id)>=4 and count(a.id) filter (where lower(a.status) in ('p','present')) * 100 < count(a.id) * 75 order by (count(a.id) filter (where lower(a.status) in ('p','present')))::numeric / nullif(count(a.id),0), s.name limit 5"),
        dashboardQuery("select id, title, batch_id as batch, due_date, status from public.assignments where lower(coalesce(status,'')) not in ('completed','archived','cancelled') order by due_date nulls last limit 5"),
        dashboardQuery("select (select count(*)::int from public.academic_years) as academic_years, (select count(*)::int from public.courses) as courses, (select count(*)::int from public.batches) as batches, (select count(*)::int from public.attendance) as attendance_records, (select count(*)::int from public.payments where paid_at is not null) as recorded_payments, (select count(*)::int from public.assignments) as assignments, (select count(*)::int from public.subjects) as subjects, (select count(*)::int from public.topics) as topics, (select count(*)::int from public.fees) as fees, (select count(*)::int from public.class_messages) as messages, (select count(*)::int from public.assignment_submissions) as submissions, (select count(*)::int from public.payroll) as payroll"),
      ])).map(normalizeDashboardResult);
      const count = result => Number(safeDashboardFirst(result).count || 0);
      const totalAttendance = Number(safeDashboardFirst(attendance).total || 0);
      const sm = safeDashboardFirst(setupMetrics);
      const done = [
        Number(sm.academic_years || 0) > 0,
        Number(sm.courses || 0) > 0,
        Number(sm.batches || 0) > 0,
        count(students) > 0,
        Number(sm.attendance_records || 0) > 0,
        Number(sm.recorded_payments || 0) > 0,
        Number(sm.assignments || 0) > 0,
        count(staff) > 0,
        Number(safeDashboardFirst(admissions).total || 0) > 0,
        Number(sm.subjects || 0) > 0,
        Number(sm.topics || 0) > 0,
        Number(sm.fees || 0) > 0,
        Number(sm.messages || 0) > 0,
        Number(sm.submissions || 0) > 0,
        Number(sm.payroll || 0) > 0,
        Boolean(safeDashboardFirst(settings).institute_name)
      ];
      const setupSteps = [
        { label: 'Set up an academic year', description: 'Save an academic year in Academic Years.', complete: done[0] },
        { label: 'Add a course', description: 'Create at least one course.', complete: done[1] },
        { label: 'Create a batch', description: 'Save a batch and associate it with a course.', complete: done[2] },
        { label: 'Enroll your first student', description: 'Add a student record.', complete: done[3] },
        { label: 'Record attendance', description: 'Save attendance for any date.', complete: done[4] },
        { label: 'Record a fee payment', description: 'Save a payment with a payment date.', complete: done[5] },
        { label: 'Create homework', description: 'Save an assignment.', complete: done[6] },
        { label: 'Add a staff member', description: 'Create a staff record.', complete: done[7] },
        { label: 'Receive an admission', description: 'Save an online admission application.', complete: done[8] },
        { label: 'Add a subject', description: 'Create a subject in Curriculum.', complete: done[9] },
        { label: 'Add a topic', description: 'Create a topic under a subject.', complete: done[10] },
        { label: 'Create a fee record', description: 'Assign a fee to a student.', complete: done[11] },
        { label: 'Send a broadcast', description: 'Send a class or institute message.', complete: done[12] },
        { label: 'Review homework', description: 'Save an assignment submission.', complete: done[13] },
        { label: 'Set up payroll', description: 'Record a payroll entry.', complete: done[14] },
        { label: 'Set institute details', description: 'Save the institute profile in Settings.', complete: done[15] },
      ];
      const config = safeDashboardFirst(settings).config || {};
      return json(res, 200, {
        setup: { completed: done.filter(Boolean).length, total: done.length, steps: setupSteps },
        stats: {
          students: count(students), activeStudents: count(activeStudents),
          attendancePresent: Number(safeDashboardFirst(attendance).present || 0), attendanceTotal: totalAttendance,
          attendanceRate: totalAttendance ? Math.round(Number(safeDashboardFirst(attendance).present || 0) * 100 / totalAttendance) : null,
          feesCollected: Number(safeDashboardFirst(payments).total || 0), paymentsThisMonth: Number(safeDashboardFirst(payments).count || 0),
          pendingAdmissions: Number(safeDashboardFirst(admissions).pending || 0), staff: count(staff), feePending: Number(safeDashboardFirst(pendingFees).total || 0), atRisk: safeDashboardRows(atRiskStudents).length,
        },
        enrollment: safeDashboardRows(monthlyEnrollments).map(row => ({ label: row.label, year: Number(row.year), quarter: Number(row.quarter), count: Number(row.count) })),
        feeCollection: safeDashboardRows(monthlyFees).map(row => ({ label: row.label, amount: Number(row.amount) })),
        demographics: {
          gender: safeDashboardRows(demographics).map(row => ({ label: row.label, count: Number(row.count) })),
          states: safeDashboardRows(stateDemographics).map(row => ({ label: row.label, count: Number(row.count) })),
          cities: safeDashboardRows(cityDemographics).map(row => ({ label: row.label, count: Number(row.count) })),
        },
        recentTransactions: safeDashboardRows(recentTransactions).map(row => ({ id: row.id, student: row.student_name, description: row.description, amount: Number(row.amount || 0), date: row.paid_at, method: row.method, receipt: row.receipt_number })),
        recentAdmissions: safeDashboardRows(recentAdmissions).map(row => ({ id: row.application_no, name: row.name, batch: row.batch_name || '', status: row.status, date: row.applied_at })),
        studentBirthdays: safeDashboardRows(studentBirthdays),
        staffBirthdays: safeDashboardRows(staffBirthdays),
        atRiskStudents: safeDashboardRows(atRiskStudents).map(row => ({ id: row.id, name: row.name || 'Student', batch: row.batch, attendance: Math.round(Number(row.present) * 100 / Math.max(1, Number(row.marked))) })),
        activeHomework: safeDashboardRows(activeHomework).map(row => ({ id: row.id, title: row.title || 'Homework', batch: row.batch || '', due: row.due_date, status: row.status })),
        todayAttendance: { total: Number(safeDashboardFirst(attendance).total || 0), present: Number(safeDashboardFirst(attendance).present || 0) },
        upcomingExams: [],
        todayClasses: [],
        topPerformers: [],
        peakMonths: safeDashboardRows(monthlyEnrollments).filter(row => Number(row.count) === Math.max(0, ...safeDashboardRows(monthlyEnrollments).map(item => Number(item.count)))).filter(row => Number(row.count) > 0).map(row => row.label),
        forecast: Array.from({ length: 3 }, () => Math.round(safeDashboardRows(monthlyEnrollments).reduce((sum, row) => sum + Number(row.count), 0) / Math.max(1, safeDashboardRows(monthlyEnrollments).length))),
      });
    } catch (error) {
      logDatabaseFailure('response assembly', error, '/api/admin/dashboard');
      return json(res, 200, emptyDashboardPayload());
    }
  }
  if (url.pathname.startsWith('/api/teacher/')) {
    if (!actor || !['teacher', 'admin'].includes(actor.role)) return json(res, 403, { error: 'Teacher access is required.' });
    if (req.method === 'POST' && !validCsrfRequest(req, session)) return json(res, 403, { error: 'CSRF validation failed.' });
    try {
      const pool = getPool();
      if (req.method === 'GET' && url.pathname === '/api/teacher/assignments') {
        const { rows } = await pool.query('select record_json from public.assignments order by created_at desc');
        return json(res, 200, { assignments: rows.map(row => row.record_json) });
      }
      if (req.method === 'GET' && url.pathname === '/api/teacher/attendance') {
        const { rows } = await pool.query('select record_json from public.attendance order by attendance_date desc limit 1000');
        return json(res, 200, { records: rows.map(row => row.record_json) });
      }
      if (req.method === 'POST' && url.pathname === '/api/teacher/assignments') {
        const title = cleanText(input.title, 200), batch = cleanText(input.batch, 160), due = cleanText(input.due, 20);
        if (!title || !batch || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return json(res, 400, { error: 'Provide an assignment title, batch, and due date.' });
        const record = { id: randomToken(16), title, batch, batchId: cleanText(input.batchId || batch, 160), due, status: 'Published', createdBy: actor.id };
        await pool.query('insert into public.assignments(id,title,batch_id,due_date,status,created_by,record_json) values($1,$2,$3,$4,$5,$6,$7::jsonb)', [record.id, title, record.batchId, due, record.status, actor.id, JSON.stringify(record)]);
        return json(res, 201, { assignment: record });
      }
      if (req.method === 'POST' && url.pathname === '/api/teacher/attendance') {
        if (!Array.isArray(input.records) || input.records.length > 500) return json(res, 400, { error: 'Provide up to 500 attendance records.' });
        const saved = [];
        for (const item of input.records) {
          const date = cleanText(item.date, 10), roll = cleanText(item.roll, 120), status = cleanText(item.status, 12);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !roll || !['P', 'A', 'L', 'E'].includes(status)) return json(res, 400, { error: 'Attendance date, roll, or status is invalid.' });
          const { rows: matches } = await pool.query('select id from public.students where roll=$1 limit 1', [roll]);
          const studentId = matches[0]?.id || roll;
          const id = `${date}:${studentId}`;
          const record = { id, studentId, roll, date, status, markedBy: actor.id };
          await pool.query('insert into public.attendance(id,student_id,attendance_date,status,marked_by,record_json) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(id) do update set status=excluded.status,marked_by=excluded.marked_by,record_json=excluded.record_json,updated_at=now()', [id, studentId, date, status, actor.id, JSON.stringify(record)]);
          saved.push(record);
        }
        return json(res, 200, { records: saved });
      }
      if (req.method === 'POST' && url.pathname === '/api/teacher/messages') {
        const text = cleanText(input.body, 4000);
        if (!text) return json(res, 400, { error: 'Write a message before sending.' });
        const record = { id: randomToken(16), body: text, sentBy: actor.id, createdAt: new Date().toISOString() };
        await pool.query('insert into public.class_messages(id,body,sent_by,record_json) values($1,$2,$3,$4::jsonb)', [record.id, text, actor.id, JSON.stringify(record)]);
        return json(res, 201, { message: record });
      }
    } catch { return json(res, 503, { error: 'Teacher workspace data could not be saved.' }); }
    return json(res, 404, { error: 'Teacher route not found.' });
  }

  if (url.pathname === '/api/settings') {
    const suppliedAdminToken = String(req.headers['x-admission-admin-token'] || '');
    const adminAuthorized = (actor && actor.role === 'admin') || (suppliedAdminToken && safeEqual(suppliedAdminToken, admissionAdminToken));
    if (!adminAuthorized) return json(res, 403, { error: 'Administrator access is required.' });
    if (req.method === 'GET') {
      const { rows } = await getPool().query('select record_json from public.institute_settings where id=$1', ['institute-settings']);
      return json(res, 200, { settings: rows[0]?.record_json || { instituteName: 'My JEE Mentor', academicYear: '2026-2027', contactEmail: '', timezone: 'Asia/Kolkata' } });
    }
    if (req.method === 'PUT') {
      if (actor && !validCsrfRequest(req, session)) return json(res, 403, { error: 'CSRF validation failed.' });
      const record = { instituteName: cleanText(input.instituteName, 200), academicYear: cleanText(input.academicYear, 30), contactEmail: cleanText(input.contactEmail, 200), timezone: cleanText(input.timezone, 100) };
      if (!record.instituteName || !record.academicYear || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.contactEmail) || !record.timezone) return json(res, 400, { error: 'Check the institute settings fields.' });
      await getPool().query('insert into public.institute_settings(id,institute_name,academic_year,contact_email,timezone,record_json) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(id) do update set institute_name=excluded.institute_name,academic_year=excluded.academic_year,contact_email=excluded.contact_email,timezone=excluded.timezone,record_json=excluded.record_json,updated_at=now()', ['institute-settings', record.instituteName, record.academicYear, record.contactEmail, record.timezone, JSON.stringify(record)]);
      return json(res, 200, { ok: true, settings: record });
    }
    return json(res, 405, { error: 'Method not allowed.' });
  }
  if (url.pathname === '/api/student/assignment-submissions' && req.method === 'GET') {
    if (!actor || actor.role !== 'student') return json(res, 403, { error: 'Student access is required.' });
    const { rows } = await getPool().query('select record_json from public.assignment_submissions where student_id=$1', [String(actor.studentId || '')]);
    return json(res, 200, { submissions: rows.map(row => row.record_json) });
  }
  if (req.method === 'POST' && url.pathname === '/api/student/assignment-submissions') {
    if (!actor || actor.role !== 'student' || !validCsrfRequest(req, session)) return json(res, actor ? 403 : 401, { error: actor ? 'CSRF validation failed.' : 'Sign in required.' });
    const assignmentId = cleanText(input.assignmentId, 160), studentId = String(actor.studentId || '');
    if (!assignmentId || !studentId) return json(res, 400, { error: 'Assignment or student account details are missing.' });
    const record = { id: `${assignmentId}:${studentId}`, assignmentId, studentId, status: 'Submitted', submittedAt: new Date().toISOString() };
    try {
      await getPool().query('insert into public.assignment_submissions(id,assignment_id,student_id,status,submitted_at,record_json) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(id) do update set status=excluded.status,submitted_at=excluded.submitted_at,record_json=excluded.record_json,updated_at=now()', [record.id, assignmentId, studentId, record.status, record.submittedAt, JSON.stringify(record)]);
      return json(res, 200, { submission: record });
    } catch { return json(res, 503, { error: 'Assignment submission could not be saved.' }); }
  }

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
    if (!initialPasswords.student || initialPasswords.student.length < 10 || (parentEmail && (!initialPasswords.parent || initialPasswords.parent.length < 10))) return json(res, 400, { error: 'Configure default student and parent passwords with at least 10 characters before creating accounts.' });
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
    const email = normalizeEmail(input.email), ipAddress = requestIp(req);
    const lockResult = await getPool().query('select failed_attempts, locked_until from public.login_failures where email=$1 and ip_address=$2', [email, ipAddress]);
    const lock = lockResult.rows[0];
    if (lock?.locked_until && new Date(lock.locked_until).getTime() > Date.now()) return json(res, 423, { error: 'Too many failed attempts. Try again in 5 minutes.' });
    const account = accounts.find(item => item.email === email);
    const passwordMatches = account
      ? await verifyPassword(String(input.password || ''), account.passwordSalt, account.passwordHash)
      : await verifyPassword(String(input.password || ''), 'invalid-account-salt', '');
    if (!account || !passwordMatches) {
      const failures = Math.min(Number(lock?.failed_attempts || 0) + 1, 5);
      await getPool().query(
        `insert into public.login_failures (email, ip_address, failed_attempts, locked_until, updated_at)
         values ($1, $2, 1, null, now())
         on conflict (email, ip_address) do update set
           failed_attempts = least(login_failures.failed_attempts + 1, 5),
           locked_until = case when login_failures.failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end,
           updated_at = now()`,
        [email, ipAddress],
      );
      return json(res, 401, { error: failures >= 5 ? 'Too many failed attempts. Try again in 5 minutes.' : 'Email or password is incorrect.' });
    }
    await getPool().query('delete from public.login_failures where email=$1 and ip_address=$2', [email, ipAddress]);
    setSession(req, res, account);
    return json(res, 200, { ok: true, account: accountView(account) });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const account = session && accounts.find(item => item.id === session.accountId);
    return account ? json(res, 200, { account: accountView(account) }) : json(res, 401, { error: 'Sign in required.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const secure = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `cs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/change-password') {
    const account = session && accounts.find(item => item.id === session.accountId);
    const next = String(input.password || '');
    if (!account || !account.mustChangePassword) return json(res, 403, { error: 'Password change is not required.' });
    if (next.length < 10 || Object.values(initialPasswords).filter(Boolean).includes(next)) return json(res, 400, { error: 'Choose a password with at least 10 characters that differs from the initial default password.' });
    if (next !== input.confirmPassword) return json(res, 400, { error: 'Passwords do not match.' });
    const updated = accounts.map(item => item.id === account.id ? { ...item, passwordSalt: randomToken(16), passwordHash: '', mustChangePassword: false, sessionVersion: Number(item.sessionVersion || 0) + 1 } : item);
    const target = updated.find(item => item.id === account.id); target.passwordHash = await passwordHash(next, target.passwordSalt);
    try { await saveAccounts(updated); } catch { return json(res, 500, { error: 'Could not save the new password.' }); }
    setSession(req,res,target);
    return json(res, 200, { ok: true, account: accountView(target) });
  }

  const dataMatch = url.pathname.match(/^\/api\/(students|staff|payroll|courses|batches|attendance|fees|payments)(?:\/([^/]+))?$/);
  if (dataMatch) {
    const actor = session && accounts.find(item => item.id === session.accountId);
    const suppliedToken = String(req.headers['x-admission-admin-token'] || '');
    if ((!actor || actor.role !== 'admin') && (!suppliedToken || !safeEqual(suppliedToken, admissionAdminToken))) return json(res, 403, { error: 'Administrator access is required to manage records.' });
    const [tab, type] = collections[dataMatch[1]], recordId = dataMatch[2] ? cleanText(decodeURIComponent(dataMatch[2]), 160) : '';
    try {
      const all = await sheetsStore.getSheetRecords(tab);
      const records = all.filter(item => item._type === 'app-data' && item.collection === type);
      if (req.method === 'GET' && !recordId) {
        const visible = await Promise.all(records.map(async ({ _type, collection, ...record }) => {
          if (!['students', 'staff'].includes(dataMatch[1])) return record;
          const photo = await getPhotoMetadata(dataMatch[1], record.id);
          return { ...record, ...photo, photo_url: await getPhotoUrl(photo.photo_path, photo.photo_updated_at) };
        }));
        return json(res, 200, { records: visible });
      }
      if (req.method === 'GET' && recordId && ['students', 'staff'].includes(dataMatch[1])) {
        const target = records.find(item => item.id === recordId);
        if (!target) return json(res, 404, { error: 'Record not found.' });
        const { _type, collection, ...record } = target;
        const photo = await getPhotoMetadata(dataMatch[1], record.id);
        return json(res, 200, { record: { ...record, ...photo, photo_url: await getPhotoUrl(photo.photo_path, photo.photo_updated_at) } });
      }
      if (req.method === 'POST' && !recordId) {
        const incoming = Array.isArray(input.records) ? input.records : [input.record || input];
        if (!incoming.length || incoming.length > 1000 || incoming.some(item => !item || typeof item !== 'object' || Array.isArray(item))) return json(res, 400, { error: 'Provide between 1 and 1000 record objects.' });
        const additions = incoming.map(item => {
          const { photo, photoData, photo_data, photo_url, photo_path, photo_updated_at, image, ...safeItem } = item;
          return { ...safeItem, id: cleanText(item.id || randomToken(16), 160), _type: 'app-data', collection: type };
        });
        if (additions.some(item => records.some(existing => existing.id === item.id))) return json(res, 409, { error: 'A record with that id already exists.' });
        await sheetsStore.saveSheetRecords(tab, [...all, ...additions]);
        return json(res, 201, { records: additions.map(({ _type, collection, ...record }) => record) });
      }
      if (recordId && req.method === 'PUT') {
        const target = records.find(item => item.id === recordId);
        if (!target) return json(res, 404, { error: 'Record not found.' });
        const incoming = input.record || input;
        const { photo, photoData, photo_data, photo_url, photo_path, photo_updated_at, image, ...safeIncoming } = incoming;
        const replacement = { ...safeIncoming, id: recordId, _type: 'app-data', collection: type };
        await sheetsStore.saveSheetRecords(tab, all.map(item => item.id === recordId && item._type === 'app-data' && item.collection === type ? replacement : item));
        const { _type, collection, ...record } = replacement;
        return json(res, 200, { record });
      }
      if (recordId && req.method === 'DELETE') {
        const existing = records.find(item => item.id === recordId);
        if (existing && ['students', 'staff'].includes(dataMatch[1])) {
          const photoId = dataMatch[1] === 'staff' ? String(existing.employee_id || existing.employeeId || existing.id) : String(existing.student_id || existing.studentId || existing.id);
          const metadata = await getPhotoMetadata(dataMatch[1], existing.id);
          if (metadata.photo_path) {
            await deletePhoto(dataMatch[1], photoId);
            await saveProfile(dataMatch[1], existing, { photo_path: null, photo_updated_at: null });
          }
        }
        const remaining = all.filter(item => !(item.id === recordId && item._type === 'app-data' && item.collection === type));
        if (remaining.length === all.length) return json(res, 404, { error: 'Record not found.' });
        await sheetsStore.saveSheetRecords(tab, remaining);
        return json(res, 200, { ok: true });
      }
      return json(res, 405, { error: 'Method not allowed for this records route.' });
    } catch (error) { console.error(`PostgreSQL ${dataMatch[1]} request failed:`, error.message); return json(res, 503, { error: error.message || 'PostgreSQL could not complete this request.' }); }
  }
  return json(res, 404, { error: 'API route not found.' });
}


module.exports = { api, resolveSessionAccount, changeAccountPassword };
