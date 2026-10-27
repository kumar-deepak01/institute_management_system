const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { z } = require('zod');
const { getPool } = require('../services/postgresStore');
const { passwordHash } = require('../security/password');
const { getPhotoUrl, getPhotoUrls, deletePhoto } = require('../services/photoStorage');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getPhotoMetadata } = require('../services/profileRecords');
const { formulaSafe } = require('./studentController');
const { isAdminRole, normalizeRole } = require('../middleware/auth');

const receiveFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('file');
const statsCache = { expiresAt: 0, value: null };
const lookupsCache = { expiresAt: 0, value: null };
const CACHE_TTL_MS = 15000;
const clean = (value, size = 300) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, size);
const id = () => crypto.randomUUID();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const employmentTypes = ['Full-Time', 'Contractual', 'Part-Time / Hybrid', 'Hourly Basis'];
const schemaErrorCodes = new Set(['42P01', '42703']);
const isSchemaPending = error => schemaErrorCodes.has(String(error?.code || ''));
const emptyStats = (schemaPending = false) => ({ totalStaff: 0, active: 0, inactive: 0, todaysClasses: 0, salaryMonthly: 0, schemaPending });
const emptyList = (schemaPending = false, page = 1, limit = 24) => ({ records: [], total: 0, page, limit, pages: 1, counts: { all: 0, active: 0, inactive: 0 }, typeCounts: {}, stats: emptyStats(schemaPending), schemaPending });
function safeLog(step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error')
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted connection string]')
    .replace(/\b(password|hash|cookie|authorization|database_url|bank_account_number|account_number|pan_number|pan)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .slice(0, 400);
  console.error(`[staff] ${step} failed (code=${code}): ${message}`);
}

const assignmentSchema = z.object({ courseId: z.string().max(120).optional().default(''), subjectId: z.string().min(1).max(120), batchId: z.string().max(120).optional().default('') });
const staffSchema = z.object({
  name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254), phone: z.string().trim().min(7).max(40),
  employeeId: z.string().trim().max(80).optional().default(''), staffType: z.string().trim().min(2).max(40).default('Teacher'),
  branches: z.array(z.string().max(120)).max(50).default([]), qualification: z.string().trim().min(2).max(180), specialization: z.string().trim().max(180).default(''),
  experienceYears: z.coerce.number().min(0).max(80).default(0), joiningDate: z.string().max(20).default(''), bio: z.string().max(3000).default(''),
  employmentType: z.enum(['Full-Time','Contractual','Part-Time / Hybrid','Hourly Basis']).default('Full-Time'),
  monthlySalary: z.coerce.number().min(0).max(100000000).default(0), baseSalary: z.coerce.number().min(0).max(100000000).default(0),
  perClassRate: z.coerce.number().min(0).max(10000000).default(0), hourlyRate: z.coerce.number().min(0).max(10000000).default(0),
  pfPercent: z.coerce.number().min(0).max(100).default(12), tdsPercent: z.coerce.number().min(0).max(100).default(0),
  paymentMode: z.enum(['bank','upi','both','']).default('both'),
  accountHolderName: z.string().trim().max(120).default(''),
  bankAccountNumber: z.string().trim().max(34).default(''),
  confirmBankAccountNumber: z.string().trim().max(34).optional().default(''),
  bankName: z.string().trim().max(120).default(''),
  ifscCode: z.string().trim().max(11).default(''),
  branch: z.string().trim().max(120).default(''),
  upiId: z.string().trim().max(120).default(''),
  panNumber: z.string().trim().max(10).default(''),
  assignments: z.array(assignmentSchema).max(100).default([]), temporaryPassword: z.string().max(200).optional().default(''), confirmPassword: z.string().max(200).optional().default(''),
  status: z.enum(['active','inactive']).default('active'),
});

function parseStaff(input, isFormSubmit = false) {
  const parsed = staffSchema.safeParse(input || {});
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || 'Check the staff details and try again.' };
  const fields = parsed.data;
  fields.email = fields.email.toLowerCase();
  fields.employeeId = clean(fields.employeeId, 80);
  fields.staffType = clean(fields.staffType, 40);
  fields.phone = clean(fields.phone, 40);
  fields.qualification = clean(fields.qualification, 180);
  fields.specialization = clean(fields.specialization, 180);
  fields.bio = clean(fields.bio, 3000);
  fields.joiningDate = clean(fields.joiningDate, 20);
  fields.accountHolderName = clean(fields.accountHolderName, 120);
  fields.bankName = clean(fields.bankName, 120);
  fields.branch = clean(fields.branch, 120);
  fields.upiId = clean(fields.upiId, 120).trim();
  fields.paymentMode = clean(fields.paymentMode, 20) || 'both';
  fields.ifscCode = fields.ifscCode.toUpperCase().trim();
  fields.panNumber = fields.panNumber.toUpperCase().trim();
  fields.bankAccountNumber = fields.bankAccountNumber.replace(/\s/g, '');
  if (fields.confirmBankAccountNumber) {
    fields.confirmBankAccountNumber = fields.confirmBankAccountNumber.replace(/\s/g, '');
  }
  if (!emailPattern.test(fields.email)) return { error: 'Enter a valid staff email address.' };
  if (fields.joiningDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.joiningDate)) return { error: 'Enter a valid joining date.' };

  // Rule: At least ONE payment method (Bank Account OR UPI ID) is mandatory on staff add/edit
  if (isFormSubmit && !fields.bankAccountNumber && !fields.upiId) {
    return { error: 'Please provide either Bank Account or UPI details for payroll payouts.' };
  }

  if (fields.bankAccountNumber) {
    if (!/^[0-9]{6,34}$/.test(fields.bankAccountNumber)) return { error: 'Enter a valid bank account number (6 to 34 digits).' };
    if (fields.confirmBankAccountNumber && fields.bankAccountNumber !== fields.confirmBankAccountNumber) {
      return { error: 'Bank account numbers do not match.' };
    }
    if (fields.ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(fields.ifscCode)) return { error: 'Enter a valid 11-character IFSC code (e.g. HDFC0001234).' };
    if (!fields.accountHolderName) fields.accountHolderName = fields.name;
  }
  if (fields.upiId) {
    if (!/^[\w.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/.test(fields.upiId)) {
      return { error: 'Enter a valid UPI ID (e.g. name@okhdfcbank or 9876543210@paytm).' };
    }
  }

  if (fields.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(fields.panNumber)) return { error: 'Enter a valid PAN number.' };
  if (fields.temporaryPassword && fields.temporaryPassword.length < 10) return { error: 'Temporary password must have at least 10 characters.' };
  if (fields.temporaryPassword !== fields.confirmPassword) return { error: 'Passwords do not match.' };
  return { fields };
}

function formatEmployeeId(number) { return `EMP-${String(number).padStart(3, '0')}`; }
async function allocateEmployeeId(client) {
  const { rows } = await client.query("update public.staff_employee_counters set next_value=next_value+1,updated_at=now() where counter_name='employee' returning next_value-1 as value");
  if (!rows[0]) throw Object.assign(new Error('Employee ID counter is unavailable. Apply the staff migration.'), { statusCode: 503 });
  return formatEmployeeId(Number(rows[0].value));
}
async function reserveManualEmployeeId(client, employeeId) {
  const suffix = employeeId.match(/(\d+)$/)?.[1];
  if (suffix) await client.query("update public.staff_employee_counters set next_value=greatest(next_value,$1),updated_at=now() where counter_name='employee'", [Number(suffix) + 1]);
}
async function nextEmployeeId() {
  const { rows } = await getPool().query("select next_value from public.staff_employee_counters where counter_name='employee'");
  return formatEmployeeId(Number(rows[0]?.next_value || 1));
}

function maskAccount(value) { const digits = String(value || '').replace(/\D/g, ''); return digits ? `•••• ${digits.slice(-4)}` : ''; }
function maskPan(value) { const pan = String(value || ''); return pan ? `${pan.slice(0, 1)}••••${pan.slice(5, 9)}•` : ''; }
function safeStaff(row, privateRow = null, fullBank = false) {
  const raw = row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
  const bank = privateRow || {};
  return {
    id: row.id, staffKey: row.staff_key, name: row.name || '', email: row.email || '', phone: row.phone || '', employeeId: row.employee_id || '',
    staffType: row.staff_type || raw.staffType || 'Teacher', status: row.status || 'active', role: 'teacher',
    qualification: row.qualification || '', specialization: row.specialization || '', experienceYears: Number(row.experience_years || 0),
    joiningDate: row.joining_date || null, bio: row.bio || '', employmentType: row.employment_type || 'Full-Time',
    monthlySalary: Number(row.monthly_salary || 0), baseSalary: Number(row.base_salary || 0), perClassRate: Number(row.per_class_rate || 0), hourlyRate: Number(row.hourly_rate || 0),
    pfPercent: Number(row.pf_percent ?? 12), tdsPercent: Number(row.tds_percent || 0), branches: Array.isArray(row.branch_ids) ? row.branch_ids : [],
    assignments: Array.isArray(row.assignments) ? row.assignments : [], photoPath: row.photo_path || null, photoUpdatedAt: row.photo_updated_at || null,
    photoUrl: row.photo_url || null, accountHolderName: bank.account_holder_name || '', accountLast4: maskAccount(bank.bank_account_number), panMasked: maskPan(bank.pan_number), bankName: bank.bank_name || '', branch: bank.branch || '', upiId: fullBank ? (bank.upi_id || '') : (bank.upi_id ? maskAccount(bank.upi_id) : ''), paymentMode: bank.payment_mode || 'both', hasPaymentDetails: Boolean(bank.bank_account_number || bank.upi_id),
    ...(fullBank ? { bankAccountNumber: bank.bank_account_number || '', ifscCode: bank.ifsc_code || '', panNumber: bank.pan_number || '', upiId: bank.upi_id || '', branch: bank.branch || '', accountHolderName: bank.account_holder_name || '', paymentMode: bank.payment_mode || 'both' } : {}),
  };
}

function filters(url) {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 24)));
  return { page, limit, offset: (page - 1) * limit, q: clean(url.searchParams.get('q'), 120), status: ['active','inactive'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : '', type: clean(url.searchParams.get('type'), 40) };
}
function makeWhere(f, values) {
  const conditions = [];
  if (f.status) { values.push(f.status); conditions.push(`lower(coalesce(s.status,'active'))=$${values.length}`); }
  if (f.type && f.type !== 'All Staff') { values.push(f.type); conditions.push(`coalesce(s.staff_type,'Teacher')=$${values.length}`); }
  if (f.q) {
    values.push(`%${f.q}%`);
    const n = values.length;
    conditions.push(`(s.name ilike $${n} or s.email ilike $${n} or s.employee_id ilike $${n} or exists(select 1 from public.staff_subject_assignments ax join public.subjects sx on sx.id=ax.subject_id where ax.staff_id=s.id and sx.name ilike $${n}))`);
  }
  return conditions.length ? `where ${conditions.join(' and ')}` : '';
}
const orderBy = (sort, alias = 'f') => ({
  name: `${alias}.name asc nulls last`,
  'name-desc': `${alias}.name desc nulls last`,
  employee: `${alias}.employee_id asc nulls last`,
  'employee-desc': `${alias}.employee_id desc nulls last`,
  salary: `${alias}.monthly_salary desc nulls last`,
  joined: `${alias}.joining_date desc nulls last`,
}[sort] || `${alias}.name asc nulls last`);

const staffSelect = `
  with base as (
    select s.id,s.staff_key,s.employee_id,s.name,s.email,s.phone,s.status,s.staff_type,s.qualification,s.specialization,s.experience_years,
      s.joining_date,s.bio,s.employment_type,s.monthly_salary,s.base_salary,s.per_class_rate,s.hourly_rate,s.pf_percent,s.tds_percent,
      s.branch_ids,s.photo_path,s.photo_updated_at,s.record_json
    from public.staff s
  ),
  filtered as (select s.* from base s /*FILTER*/),
  page as (select f.* from filtered f order by /*ORDER*/ limit $LIMIT offset $OFFSET),
  assignment_totals as (
    select x.staff_id,jsonb_agg(jsonb_build_object('id',x.id,'courseId',x.course_id,'courseName',coalesce(c.name,''),'subjectId',x.subject_id,'subjectName',coalesce(u.name,''),'batchId',x.batch_id,'batchName',coalesce(b.name,'All Batches')) order by c.name,u.name,b.name) assignments
    from public.staff_subject_assignments x left join public.courses c on c.id=x.course_id left join public.subjects u on u.id=x.subject_id left join public.batches b on b.id=x.batch_id
    where x.staff_id=any(array(select id from page)) group by x.staff_id
  ),
  page_rows as (
    select f.*,coalesce(a.assignments,'[]'::jsonb) as assignments,
      p.bank_account_number,p.bank_name,p.ifsc_code,p.pan_number,p.account_holder_name,p.branch,p.upi_id,p.payment_mode
    from page f
    left join assignment_totals a on a.staff_id=f.id
    left join public.staff_private p on p.staff_id=f.id
  )
  select coalesce((select jsonb_agg(to_jsonb(p) order by /*FINAL_ORDER*/) from page_rows p),'[]'::jsonb) as rows,
    (select count(*)::int from filtered) as total,
    (select count(*)::int from base where lower(coalesce(status,'active'))='active') as active_count,
    (select count(*)::int from base where lower(coalesce(status,'active'))<>'active') as inactive_count,
    (select coalesce(jsonb_object_agg(staff_type,cnt),'{}'::jsonb) from (select coalesce(staff_type,'Teacher') staff_type,count(*)::int cnt from base group by 1) types) as type_counts,
    (select count(*)::int from base) as total_count,
    (select coalesce(sum(monthly_salary),0)::numeric from base where lower(coalesce(status,'active'))='active') as salary_total,
    (select count(*)::int from public.app_records t where t.source_tab in ('Timetable','Schedule') and coalesce(t.record_json->>'date',t.record_json->>'classDate',t.record_json->>'startDate')=to_char(current_date,'YYYY-MM-DD')) as classes_today`;

function buildStaffListQuery(url) {
  const f = filters(url), values = [], where = makeWhere(f, values);
  const limitAt = values.length + 1, offsetAt = values.length + 2;
  values.push(f.limit, f.offset);
  const sql = staffSelect.replace('/*FILTER*/', where).replace('/*ORDER*/', orderBy(url.searchParams.get('sort'), 'f')).replace('/*FINAL_ORDER*/', orderBy(url.searchParams.get('sort'), 'p')).replace('$LIMIT', `$${limitAt}`).replace('$OFFSET', `$${offsetAt}`);
  return { sql, values, page: f.page, limit: f.limit };
}

async function listStaff(url) {
  const { sql, values, page, limit } = buildStaffListQuery(url);
  const result = await queryWithLimit(() => getPool().query(sql, values));
  const row = result.rows[0] || {};
  const rows = Array.isArray(row.rows) ? row.rows : [];
  const photoUrls = await getPhotoUrls(rows.map(item => ({ path: item.photo_path, updatedAt: item.photo_updated_at }))).catch(error => { safeLog('list photo URLs', error); return rows.map(() => null); });
  const records = rows.map((item,index) => safeStaff({ ...item, photo_url: photoUrls[index] }, item, false));
  const total = Number(row.total || 0);
  return { records, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), counts: { all: Number(row.total_count || 0), active: Number(row.active_count || 0), inactive: Number(row.inactive_count || 0) }, typeCounts: row.type_counts || {}, stats: { totalStaff: Number(row.total_count || 0), active: Number(row.active_count || 0), inactive: Number(row.inactive_count || 0), todaysClasses: Number(row.classes_today || 0), salaryMonthly: Number(row.salary_total || 0), schemaPending: false }, schemaPending: false };
}

const staffStatsSql = `select count(*)::int total_staff,
  count(*) filter(where lower(coalesce(status,'active'))='active')::int active,
  count(*) filter(where lower(coalesce(status,'active'))<>'active')::int inactive,
  coalesce(sum(monthly_salary) filter(where lower(coalesce(status,'active'))='active'),0)::numeric salary_monthly,
  (select count(*)::int from public.app_records t where t.source_tab in ('Timetable','Schedule') and coalesce(t.record_json->>'date',t.record_json->>'classDate',t.record_json->>'startDate')=to_char(current_date,'YYYY-MM-DD')) todays_classes
  from public.staff`;

async function getStats() {
  if (statsCache.value && statsCache.expiresAt > Date.now()) return statsCache.value;
  const { rows } = await queryWithLimit(() => getPool().query(staffStatsSql));
  const r = rows[0] || {};
  statsCache.value = { totalStaff: Number(r.total_staff || 0), active: Number(r.active || 0), inactive: Number(r.inactive || 0), todaysClasses: Number(r.todays_classes || 0), salaryMonthly: Number(r.salary_monthly || 0), schemaPending: false };
  statsCache.expiresAt = Date.now() + CACHE_TTL_MS;
  return statsCache.value;
}
function invalidateStats() { statsCache.expiresAt = 0; statsCache.value = null; lookupsCache.expiresAt = 0; lookupsCache.value = null; }

async function getLookups() {
  if (lookupsCache.value && lookupsCache.expiresAt > Date.now()) return lookupsCache.value;
  const result = { courses: [], subjects: [], batches: [], branches: [], schemaPending: false };
  const queries = [
    ['courses', 'select id,name from public.courses order by name'],
    ['subjects', 'select id,name,course_id from public.subjects order by name'],
    ['batches', 'select id,name,course_id,course_name from public.batches where active is distinct from false order by name'],
    ['branches', "select record_id,record_json from public.app_records where source_tab='Branches' and record_json->>'status' is distinct from 'inactive' order by record_id"],
  ];
  const values = await Promise.all(queries.map(([key, sql]) => queryWithLimit(() => getPool().query(sql)).then(query => ({ key, rows: query.rows })).catch(error => { safeLog(`lookup ${key}`, error); if (isSchemaPending(error)) result.schemaPending = true; return { key, rows: [] }; })));
  for (const item of values) {
    if (item.key === 'branches') result.branches = item.rows.map(row => ({ id: String(row.record_json?.id || row.record_id), ...row.record_json })).map(item => ({ id: item.id, name: clean(item.name || item.branchName, 120) })).filter(item => item.name);
    else result[item.key] = item.rows;
  }
  lookupsCache.value = result;
  lookupsCache.expiresAt = Date.now() + CACHE_TTL_MS;
  return result;
}

function validateReferences(fields, lookups) {
  const subjectIds = new Set(lookups.subjects.map(row => String(row.id)));
  const courseIds = new Set(lookups.courses.map(row => String(row.id)));
  const batchIds = new Set(lookups.batches.map(row => String(row.id)));
  if (fields.assignments.some(item => !subjectIds.has(item.subjectId) || (item.courseId && !courseIds.has(item.courseId)) || (item.batchId && !batchIds.has(item.batchId)))) return 'Choose valid courses, subjects, and batches for each assignment.';
  const branchIds = new Set(lookups.branches.map(row => String(row.id)));
  if (fields.branches.some(branchId => !branchIds.has(branchId))) return 'Choose valid branches from the list.';
  return '';
}

function makeRecord(fields, staffId, staffKey, employeeId, existing = {}) {
  return {
    ...existing, id: staffId, staffKey, staffId, employeeId, name: fields.name, email: fields.email, phone: fields.phone,
    role: 'teacher', staffType: fields.staffType, status: fields.status, qualification: fields.qualification, specialization: fields.specialization,
    experienceYears: fields.experienceYears, joiningDate: fields.joiningDate || null, bio: fields.bio, employmentType: fields.employmentType,
    monthlySalary: fields.monthlySalary, baseSalary: fields.baseSalary, perClassRate: fields.perClassRate, hourlyRate: fields.hourlyRate,
    pfPercent: fields.pfPercent, tdsPercent: fields.tdsPercent, branches: fields.branches,
  };
}
async function persistAssignments(client, staffId, assignments) {
  await client.query('delete from public.staff_subject_assignments where staff_id=$1', [staffId]);
  for (const assignment of assignments) await client.query('insert into public.staff_subject_assignments(id,staff_id,course_id,subject_id,batch_id) values($1,$2,nullif($3,\'\'),$4,nullif($5,\'\'))', [id(), staffId, assignment.courseId || '', assignment.subjectId, assignment.batchId || '']);
}
async function saveStaffRecords(client, staffId, staffRecord, accountRecord = null) {
  await client.query(`insert into public.app_records(source_tab,record_id,record_json) values('Staff',$1,$2::jsonb)
    on conflict(source_tab,record_id) do update set record_json=excluded.record_json,updated_at=now()`, [staffId, JSON.stringify({ _type: 'app-data', collection: 'staff', ...staffRecord })]);
  // Account is stored in public.accounts table directly
}
async function insertStaff(client, fields) {
  const envPassword = process.env.DEFAULT_STAFF_PASSWORD || '';
  const chosenPassword = fields.temporaryPassword || envPassword;
  if (!chosenPassword || chosenPassword.length < 10) throw Object.assign(new Error('Enter a temporary password of at least 10 characters or configure DEFAULT_STAFF_PASSWORD with at least 10 characters.'), { statusCode: 400 });
  const lookups = await getLookups();
  const referenceError = validateReferences(fields, lookups);
  if (referenceError) throw Object.assign(new Error(referenceError), { statusCode: 400 });
  const duplicate = await client.query('select 1 from public.accounts where lower(email)=lower($1) limit 1', [fields.email]);
  if (duplicate.rowCount) throw Object.assign(new Error('That email address already belongs to an account.'), { statusCode: 409 });
  const staffId = id(), staffKey = id();
  let employeeId = fields.employeeId || await allocateEmployeeId(client);
  const duplicateEmployee = await client.query('select 1 from public.staff where lower(employee_id)=lower($1) limit 1', [employeeId]);
  if (duplicateEmployee.rowCount) throw Object.assign(new Error('That employee ID is already assigned.'), { statusCode: 409 });
  await reserveManualEmployeeId(client, employeeId);
  const staffRecord = makeRecord(fields, staffId, staffKey, employeeId);
  const salt = crypto.randomBytes(16).toString('base64url');
  const accountId = id();
  const accountRecord = { id: accountId, email: fields.email, role: 'teacher', name: fields.name, studentId: staffId, staffId, employeeId, staffType: fields.staffType, status: fields.status, mustChangePassword: true, sessionVersion: 0, passwordSalt: salt, passwordHash: await passwordHash(chosenPassword, salt) };
  await client.query(`insert into public.staff(id,staff_key,employee_id,name,email,phone,role,status,staff_type,qualification,specialization,experience_years,joining_date,bio,employment_type,monthly_salary,base_salary,per_class_rate,hourly_rate,pf_percent,tds_percent,branch_ids,record_json)
    values($1,$2,$3,$4,$5,$6,'teacher',$7,$8,$9,$10,$11,nullif($12,'')::date,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22::jsonb)`,
  [staffId, staffKey, employeeId, fields.name, fields.email, fields.phone, fields.status, fields.staffType, fields.qualification, fields.specialization, fields.experienceYears, fields.joiningDate, fields.bio, fields.employmentType, fields.monthlySalary, fields.baseSalary, fields.perClassRate, fields.hourlyRate, fields.pfPercent, fields.tdsPercent, JSON.stringify(fields.branches), JSON.stringify(staffRecord)]);
  await client.query(`insert into public.accounts(id,email,role,name,student_id,password_hash,password_salt,must_change_password,session_version,record_json)
    values($1,$2,'teacher',$3,$4,$5,$6,true,0,$7::jsonb)`, [accountId, fields.email, fields.name, staffId, accountRecord.passwordHash, salt, JSON.stringify(accountRecord)]);
  if (fields.bankAccountNumber || fields.bankName || fields.ifscCode || fields.panNumber || fields.upiId || fields.accountHolderName) await client.query(`insert into public.staff_private(staff_id,bank_account_number,bank_name,ifsc_code,pan_number,account_holder_name,branch,upi_id,payment_mode) values($1,nullif($2,''),nullif($3,''),nullif($4,''),nullif($5,''),nullif($6,''),nullif($7,''),nullif($8,''),coalesce(nullif($9,''),'both'))`, [staffId, fields.bankAccountNumber, fields.bankName, fields.ifscCode, fields.panNumber, fields.accountHolderName, fields.branch, fields.upiId, fields.paymentMode]);
  await persistAssignments(client, staffId, fields.assignments);
  await saveStaffRecords(client, staffId, staffRecord, accountRecord);
  return { id: staffId, staffKey, employeeId, accountId, name: fields.name };
}

function exportFields(item, includeBank) {
  const assignments = (item.assignments || []).map(a => a.subjectName).filter(Boolean).join('; ');
  const record = { Name: item.name, Email: item.email, Phone: item.phone, 'Employee ID': item.employeeId, 'Staff Type': item.staffType, Status: item.status, Qualification: item.qualification, Specialization: item.specialization, Experience: item.experienceYears, 'Joining Date': item.joiningDate, 'Employment Type': item.employmentType, 'Monthly Salary': item.monthlySalary, 'Base Salary': item.baseSalary, 'Per Class Rate': item.perClassRate, 'Hourly Rate': item.hourlyRate, 'PF %': item.pfPercent, 'TDS %': item.tdsPercent, Subjects: assignments };
  if (includeBank) Object.assign(record, { 'Bank Account': item.bankAccountNumber, 'Bank Name': item.bankName, IFSC: item.ifscCode, PAN: item.panNumber });
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, formulaSafe(value)]));
}
function csvData(rows, includeBank) {
  if (!rows.length) return '\uFEFF';
  const records = rows.map(row => exportFields(row, includeBank)), headers = Object.keys(records[0]);
  const q = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [headers.map(q).join(','), ...records.map(row => headers.map(key => q(row[key])).join(','))].join('\r\n');
}
function parseCsv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){row.push(cell);cell='';}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(v=>v!==''))rows.push(row);row=[];}else cell+=ch;}
  row.push(cell);if(row.some(v=>v!==''))rows.push(row);if(rows.length<2)return[];
  const headers=rows.shift().map(x=>x.replace(/^\uFEFF/,'').trim());return rows.map(values=>Object.fromEntries(headers.map((header,i)=>[header,values[i]??''])));
}
function importFields(row) {
  const normalized=Object.fromEntries(Object.entries(row||{}).map(([key,value])=>[key.toLowerCase().replace(/[^a-z]/g,''),value]));
  const pick=(...keys)=>String(keys.map(key=>normalized[key]).find(value=>value!==undefined&&value!==null)??'').trim();
  return { name:pick('name','fullname'), email:pick('email','emailaddress'), phone:pick('phone','phonenumber'), employeeId:pick('employeeid'), staffType:pick('stafftype')||'Teacher', qualification:pick('qualification'), specialization:pick('specialization'), experienceYears:pick('experienceyears')||0, joiningDate:pick('joiningdate'), employmentType:pick('employmenttype')||'Full-Time', monthlySalary:pick('monthlysalary')||0, baseSalary:pick('basesalary')||0, perClassRate:pick('perclassrate')||0, hourlyRate:pick('hourlyrate')||0, pfPercent:pick('pfpercent')||12, tdsPercent:pick('tdspercent')||0, branches:[], assignments:[], bankAccountNumber:'', bankName:'', ifscCode:'', panNumber:'', status:'active' };
}
async function uploadedRows(req,res) {
  await new Promise((resolve,reject)=>receiveFile(req,res,error=>error?reject(error):resolve()));
  if(!req.file)throw Object.assign(new Error('Choose a CSV or XLSX file.'),{statusCode:400});
  if(/\.csv$/i.test(req.file.originalname)||req.file.mimetype==='text/csv')return parseCsv(req.file.buffer.toString('utf8')).map(importFields);
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(req.file.buffer);const sheet=workbook.worksheets[0];if(!sheet)return[];
  const headers=sheet.getRow(1).values.slice(1).map(value=>String(value??''));const rows=[];
  for(let i=2;i<=sheet.rowCount;i++){const values=sheet.getRow(i).values.slice(1);if(values.some(value=>value!==null&&value!==undefined&&value!==''))rows.push(importFields(Object.fromEntries(headers.map((h,j)=>[h,values[j]??'']))));}
  return rows;
}
async function previewRows(rows) {
  const seen=new Set(), emails=rows.map(row=>String(row.email||'').toLowerCase()).filter(Boolean);
  const existing=emails.length?(await getPool().query('select lower(email) email from public.accounts where lower(email)=any($1::text[])',[emails])).rows.map(row=>row.email):[];
  const emailSet=new Set(existing), preview=[];
  rows.forEach((source,index)=>{const {error}=parseStaff(source);const errors=[];if(error)errors.push(error);const email=String(source.email||'').toLowerCase();if(emailSet.has(email)||seen.has(email))errors.push('Email is already assigned.');seen.add(email);preview.push({row:index+2,email:clean(source.email,254),errors});});
  return preview;
}

async function getRelated(staffId, staffKey, employeeId) {
  const [attendanceResult, payrollResult] = await Promise.all([
    getPool().query("select record_id,record_json from public.app_records where source_tab in ('Staff Attendance','StaffAttendance') order by created_at desc limit 500"),
    getPool().query('select id,employee_id,amount,paid_at,status,record_json from public.payroll where employee_id=$1 or record_json->>\'staffKey\'=$2 order by paid_at desc nulls last limit 100', [employeeId, staffKey]),
  ]);
  const attendance=attendanceResult.rows.map(row=>row.record_json||{}).filter(r=>String(r.staffId||r.employeeId||r.staffKey||'')===staffId||String(r.staffKey||'')===staffKey||String(r.employeeId||'')===employeeId);
  return { attendance, payroll: payrollResult.rows.map(row=>({id:row.id,employeeId:row.employee_id,amount:Number(row.amount||0),paidAt:row.paid_at||row.record_json?.paidAt||null,status:row.status||row.record_json?.status||''})) };
}

async function getOne(staffKey, editMode) {
  const { rows } = await getPool().query(`select s.*,coalesce(a.assignments,'[]'::jsonb) assignments,p.bank_account_number,p.bank_name,p.ifsc_code,p.pan_number,p.account_holder_name,p.branch,p.upi_id,p.payment_mode
    from public.staff s left join public.staff_private p on p.staff_id=s.id
    left join lateral (select jsonb_agg(jsonb_build_object('id',x.id,'courseId',x.course_id,'courseName',coalesce(c.name,''),'subjectId',x.subject_id,'subjectName',coalesce(u.name,''),'batchId',x.batch_id,'batchName',coalesce(b.name,'All Batches')) order by c.name,u.name,b.name) assignments
      from public.staff_subject_assignments x left join public.courses c on c.id=x.course_id left join public.subjects u on u.id=x.subject_id left join public.batches b on b.id=x.batch_id where x.staff_id=s.id) a on true
    where s.staff_key=$1 limit 1`, [staffKey]);
  if (!rows.length) return null;
  const row=rows[0];
  if (row.photo_path) { try { row.photo_url=await getPhotoUrl(row.photo_path,row.photo_updated_at); } catch(error) { safeLog('profile photo URL',error); } }
  const record=safeStaff(row,row,editMode);
  const related=await getRelated(row.id,row.staff_key,row.employee_id);
  const thisMonth=related.attendance.filter(item=>String(item.date||item.attendanceDate||'').slice(0,7)===new Date().toISOString().slice(0,7));
  const present=thisMonth.filter(item=>['p','present'].includes(String(item.status||'').toLowerCase())).length;
  return { record, attendance:related.attendance, payroll:related.payroll, monthAttendance:{present,total:thisMonth.length} };
}

async function deactivateAccount(client, staffId, accountRow) {
  if (!accountRow) return;
  const salt=crypto.randomBytes(16).toString('base64url'), impossible=crypto.randomBytes(32).toString('base64url');
  const hash=await passwordHash(impossible,salt),version=Number(accountRow.record_json?.sessionVersion||0)+1;
  const updated={...accountRow.record_json,status:'inactive',passwordSalt:salt,passwordHash:hash,mustChangePassword:true,sessionVersion:version};
  await client.query('update public.accounts set password_hash=$2,password_salt=$3,must_change_password=true,session_version=$4,record_json=$5::jsonb,updated_at=now() where id=$1',[accountRow.id,hash,salt,version,JSON.stringify(updated)]);
  await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',accountRow.id,JSON.stringify({_type:'account',...updated})]);
}

async function handleStaffRoute(req,res,url,input,actor) {
  const send=(status,payload)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload));};
  if(!actor||!isAdminRole(actor.role))return send(403,{error:'Administrator access is required.'});
  const prefix='/api/admin/staff',suffix=url.pathname.slice(prefix.length).replace(/^\//,'');
  try {
    if(!suffix&&req.method==='GET')return send(200,await listStaff(url));
    if(suffix==='stats'&&req.method==='GET')return send(200,await getStats());
    if(suffix==='lookups'&&req.method==='GET')return send(200,await getLookups());
    if(suffix==='next-employee-id'&&req.method==='GET')return send(200,{employeeId:await nextEmployeeId()});
    if(suffix==='import-template'&&req.method==='GET'){
      const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Staff');const data=[{name:'Staff Name',email:'staff@example.com',phone:'91 9000000000',employeeId:'',staffType:'Teacher',qualification:'',employmentType:'Full-Time',monthlySalary:0}];
      sheet.columns=Object.keys(data[0]).map(key=>({header:key,key,width:24}));sheet.addRows(data);const buffer=Buffer.from(await workbook.xlsx.writeBuffer());
      res.statusCode=200;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="my-jee-mentor-staff-template.xlsx"');res.end(buffer);return true;
    }
    if(suffix==='import/preview'&&req.method==='POST'){
      const rows=await uploadedRows(req,res);return send(200,{rows,preview:await previewRows(rows)});
    }
    if(suffix==='import'&&req.method==='POST'){
      if(!Array.isArray(input.rows)||input.rows.length<1||input.rows.length>250)return send(400,{error:'Choose between 1 and 250 staff rows.'});
      const prepared=input.rows.map(row=>parseStaff(row));if(prepared.some(x=>x.error))return send(400,{error:'Resolve all row validation errors before importing.'});
      const preview=await previewRows(prepared.map(x=>x.fields));if(preview.some(x=>x.errors.length))return send(409,{error:'Resolve duplicate email addresses before importing.'});
      const client=await getPool().connect();const created=[];try{await client.query('begin');for(const item of prepared)created.push(await insertStaff(client,item.fields));await client.query('commit');invalidateStats();return send(201,{created:created.length});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(suffix==='export'&&req.method==='GET'){
      const includeBank=url.searchParams.get('includeBankDetails')==='1';const all=url.searchParams.get('all')==='1';const values=[],f=filters(url);const where=all?'':makeWhere(f,values);const sort=orderBy(url.searchParams.get('sort'));
      const sql=`select s.*,coalesce(a.assignments,'[]'::jsonb) assignments,p.bank_account_number,p.bank_name,p.ifsc_code,p.pan_number from public.staff s left join public.staff_private p on p.staff_id=s.id left join lateral (select jsonb_agg(jsonb_build_object('id',x.id,'courseId',x.course_id,'courseName',coalesce(c.name,''),'subjectId',x.subject_id,'subjectName',coalesce(u.name,''),'batchId',x.batch_id,'batchName',coalesce(b.name,'All Batches'))) assignments from public.staff_subject_assignments x left join public.courses c on c.id=x.course_id left join public.subjects u on u.id=x.subject_id left join public.batches b on b.id=x.batch_id where x.staff_id=s.id) a on true ${where} order by ${orderBy(url.searchParams.get('sort'), 's')}`;
      const rows=(await getPool().query(sql,values)).rows.map(row=>safeStaff(row,row,includeBank));const records=rows.map(row=>exportFields(row,includeBank));
      if(url.searchParams.get('format')==='xlsx'){const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Staff');sheet.columns=Object.keys(records[0]||{Name:'',Email:'',Phone:'',EmployeeId:''}).map(key=>({header:key,key,width:Math.min(34,Math.max(14,key.length+2))}));sheet.addRows(records);const buffer=Buffer.from(await workbook.xlsx.writeBuffer());res.statusCode=200;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="my-jee-mentor-staff.xlsx"');res.end(buffer);return true;}
      res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="my-jee-mentor-staff.csv"');res.end(csvData(rows,includeBank));return true;
    }
    if(!suffix&&req.method==='POST'){
      const parsed=parseStaff(input, true);if(parsed.error)return send(400,{error:parsed.error});
      const client=await getPool().connect();try{await client.query('begin');const created=await insertStaff(client,parsed.fields);await client.query('commit');invalidateStats();return send(201,{record:{staffKey:created.staffKey,employeeId:created.employeeId,name:created.name}});}catch(error){await client.query('rollback');if(error.code==='23505')return send(409,{error:'Email or employee ID is already assigned.'});throw error;}finally{client.release();}
    }
    const [staffKey,action]=suffix.split('/');
    if(!staffKey)return send(404,{error:'Staff route not found.'});
    if(!action&&req.method==='GET'){const detail=await getOne(staffKey,url.searchParams.get('edit')==='1');return detail?send(200,detail):send(404,{error:'Staff member was not found.'});}
    if(!action&&req.method==='PUT'){
      const parsed=parseStaff(input, true);if(parsed.error)return send(400,{error:parsed.error});const fields=parsed.fields;
      const client=await getPool().connect();try{await client.query('begin');const found=await client.query('select * from public.staff where staff_key=$1 for update',[staffKey]);if(!found.rowCount){await client.query('rollback');return send(404,{error:'Staff member was not found.'});}const old=found.rows[0];if(fields.employeeId!==old.employee_id){const dupe=await client.query('select 1 from public.staff where lower(employee_id)=lower($1) and id<>$2',[fields.employeeId,old.id]);if(dupe.rowCount){await client.query('rollback');return send(409,{error:'That employee ID is already assigned.'});}await reserveManualEmployeeId(client,fields.employeeId);}const refs=validateReferences(fields,await getLookups());if(refs){await client.query('rollback');return send(400,{error:refs});}const record=makeRecord(fields,old.id,old.staff_key,fields.employeeId,old.record_json);await client.query(`update public.staff set employee_id=$2,name=$3,phone=$4,status=$5,staff_type=$6,qualification=$7,specialization=$8,experience_years=$9,joining_date=nullif($10,'')::date,bio=$11,employment_type=$12,monthly_salary=$13,base_salary=$14,per_class_rate=$15,hourly_rate=$16,pf_percent=$17,tds_percent=$18,branch_ids=$19::jsonb,record_json=$20::jsonb,updated_at=now() where id=$1`,[old.id,fields.employeeId,fields.name,fields.phone,fields.status,fields.staffType,fields.qualification,fields.specialization,fields.experienceYears,fields.joiningDate,fields.bio,fields.employmentType,fields.monthlySalary,fields.baseSalary,fields.perClassRate,fields.hourlyRate,fields.pfPercent,fields.tdsPercent,JSON.stringify(fields.branches),JSON.stringify(record)]);await client.query('update public.accounts set name=$2,record_json=record_json||jsonb_build_object(\'name\',$2,\'staffType\',$3),updated_at=now() where student_id=$1 and role=\'teacher\'',[old.id,fields.name,fields.staffType]);await persistAssignments(client,old.id,fields.assignments);await client.query(`insert into public.staff_private(staff_id,account_holder_name,bank_name,bank_account_number,ifsc_code,branch,upi_id,payment_mode,pan_number,updated_at) values($1,nullif($2,''),nullif($3,''),nullif($4,''),nullif($5,''),nullif($6,''),nullif($7,''),coalesce(nullif($8,''),'both'),nullif($9,''),now()) on conflict(staff_id) do update set account_holder_name=excluded.account_holder_name,bank_name=excluded.bank_name,bank_account_number=excluded.bank_account_number,ifsc_code=excluded.ifsc_code,branch=excluded.branch,upi_id=excluded.upi_id,payment_mode=excluded.payment_mode,pan_number=coalesce(excluded.pan_number,staff_private.pan_number),updated_at=now()`,[old.id,fields.accountHolderName,fields.bankName,fields.bankAccountNumber,fields.ifscCode,fields.branch,fields.upiId,fields.paymentMode,fields.panNumber]);await saveStaffRecords(client,old.id,record);await client.query('commit');invalidateStats();return send(200,{ok:true});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(action==='status'&&req.method==='POST'){
      const status=input.status==='active'?'active':input.status==='inactive'?'inactive':'';if(!status)return send(400,{error:'Choose active or inactive status.'});const client=await getPool().connect();try{await client.query('begin');const found=await client.query('select * from public.staff where staff_key=$1 for update',[staffKey]);if(!found.rowCount){await client.query('rollback');return send(404,{error:'Staff member was not found.'});}const row=found.rows[0],account=await client.query("select id,email,record_json from public.accounts where student_id=$1 and role='teacher' for update",[row.id]);const record={...row.record_json,status};await client.query('update public.staff set status=$2,record_json=record_json||jsonb_build_object(\'status\',$2),updated_at=now() where id=$1',[row.id,status]);if(status==='inactive')await deactivateAccount(client,row.id,account.rows[0]);else if(account.rows[0]){const envPassword=process.env.DEFAULT_STAFF_PASSWORD||'';if(envPassword.length<10){await client.query('rollback');return send(400,{error:'Set DEFAULT_STAFF_PASSWORD to a value at least 10 characters long before activating staff.'});}const salt=crypto.randomBytes(16).toString('base64url'),hash=await passwordHash(envPassword,salt),version=Number(account.rows[0].record_json?.sessionVersion||0)+1,accountJson={...account.rows[0].record_json,status:'active',passwordSalt:salt,passwordHash:hash,mustChangePassword:true,sessionVersion:version};await client.query('update public.accounts set password_hash=$2,password_salt=$3,must_change_password=true,session_version=$4,record_json=$5::jsonb,updated_at=now() where id=$1',[account.rows[0].id,hash,salt,version,JSON.stringify(accountJson)]);await client.query('delete from public.login_failures where email=$1',[account.rows[0].email]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',account.rows[0].id,JSON.stringify({_type:'account',...accountJson})]);}await saveStaffRecords(client,row.id,record);await client.query('commit');invalidateStats();return send(200,{ok:true,status});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(action==='reset-password'&&req.method==='POST'){
      const envPassword=process.env.DEFAULT_STAFF_PASSWORD||'';if(envPassword.length<10)return send(400,{error:'Set DEFAULT_STAFF_PASSWORD to a value at least 10 characters long.'});const client=await getPool().connect();try{await client.query('begin');const found=await client.query('select id,status from public.staff where staff_key=$1 for update',[staffKey]);if(!found.rowCount){await client.query('rollback');return send(404,{error:'Staff member was not found.'});}if(found.rows[0].status==='inactive'){await client.query('rollback');return send(409,{error:'Activate this staff member before resetting the login password.'});}const account=await client.query("select id,email,record_json from public.accounts where student_id=$1 and role='teacher' for update",[found.rows[0].id]);if(!account.rowCount){await client.query('rollback');return send(404,{error:'Staff login account was not found.'});}const row=account.rows[0],salt=crypto.randomBytes(16).toString('base64url'),hash=await passwordHash(envPassword,salt),version=Number(row.record_json?.sessionVersion||0)+1,updated={...row.record_json,status:'active',passwordSalt:salt,passwordHash:hash,mustChangePassword:true,sessionVersion:version};await client.query('update public.accounts set password_hash=$2,password_salt=$3,must_change_password=true,session_version=$4,record_json=$5::jsonb,updated_at=now() where id=$1',[row.id,hash,salt,version,JSON.stringify(updated)]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',row.id,JSON.stringify({_type:'account',...updated})]);await client.query('delete from public.login_failures where email=$1',[row.email]);await client.query('commit');invalidateStats();return send(200,{ok:true});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(action==='email'&&req.method==='POST'){
      const email=String(input.email||'').trim().toLowerCase();if(input.confirm!==true||!emailPattern.test(email))return send(400,{error:'Confirm the audited email change and enter a valid email address.'});const client=await getPool().connect();try{await client.query('begin');const found=await client.query('select * from public.staff where staff_key=$1 for update',[staffKey]);if(!found.rowCount){await client.query('rollback');return send(404,{error:'Staff member was not found.'});}const row=found.rows[0],account=await client.query("select id,email,record_json from public.accounts where student_id=$1 and role='teacher' for update",[row.id]);if(!account.rowCount){await client.query('rollback');return send(404,{error:'Staff login account was not found.'});}const existing=await client.query('select 1 from public.accounts where lower(email)=$1 and id<>$2',[email,account.rows[0].id]);if(existing.rowCount){await client.query('rollback');return send(409,{error:'That email address already belongs to an account.'});}const oldEmail=row.email,version=Number(account.rows[0].record_json?.sessionVersion||0)+1,accountJson={...account.rows[0].record_json,email,sessionVersion:version},record={...row.record_json,email};await client.query('update public.staff set email=$2,record_json=record_json||jsonb_build_object(\'email\',$2),updated_at=now() where id=$1',[row.id,email]);await client.query('update public.accounts set email=$2,session_version=$3,record_json=$4::jsonb,updated_at=now() where id=$1',[account.rows[0].id,email,version,JSON.stringify(accountJson)]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Staff',row.id,JSON.stringify({_type:'app-data',collection:'staff',...record})]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',account.rows[0].id,JSON.stringify({_type:'account',...accountJson})]);await client.query('insert into public.staff_email_changes(id,staff_id,old_email,new_email,changed_by) values($1,$2,$3,$4,$5)',[id(),row.id,oldEmail,email,actor.email]);await client.query('delete from public.login_failures where email=$1',[oldEmail]);await client.query('commit');invalidateStats();return send(200,{ok:true,email});}catch(error){await client.query('rollback');if(error.code==='23505')return send(409,{error:'That email address already belongs to an account.'});throw error;}finally{client.release();}
    }
    if(!action&&req.method==='DELETE'){
      if(input.confirm!==true)return send(400,{error:'Confirm staff deletion before continuing.'});const client=await getPool().connect();let photo=null;try{await client.query('begin');const found=await client.query('select id,employee_id,email from public.staff where staff_key=$1 for update',[staffKey]);if(!found.rowCount){await client.query('rollback');return send(404,{error:'Staff member was not found.'});}const row=found.rows[0];photo=await getPhotoMetadata('staff',row.id);const account=await client.query("select id,email,role,record_json from public.accounts where student_id=$1 and role='teacher' for update",[row.id]);if(account.rows[0]?.role==='admin'){await client.query('rollback');return send(403,{error:'Administrator accounts cannot be deleted.'});}if(account.rows[0]){await client.query("delete from public.accounts where id=$1 and role<>'admin'",[account.rows[0].id]);}await client.query('delete from public.staff where id=$1',[row.id]);await client.query("delete from public.app_records where source_tab='Staff' and record_id=$1",[row.id]);await client.query('delete from public.login_failures where email=$1',[row.email]);await client.query('commit');if(photo?.photo_path){try{await deletePhoto('staff',row.employee_id || row.id);}catch(error){safeLog('delete photo',error);}}invalidateStats();return send(200,{ok:true});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    return send(405,{error:'Method not allowed.'});
  } catch(error) {
    if(error.statusCode)return send(error.statusCode,{error:error.message});
    if(error.code==='LIMIT_FILE_SIZE')return send(413,{error:'Import files must be 5 MB or smaller.'});
    if(req.method==='GET'&&isSchemaPending(error)) {
      safeLog(suffix||'list schema pending',error);
      if(!suffix) { const f=filters(url); return send(200,emptyList(true,f.page,f.limit)); }
      if(suffix==='stats')return send(200,emptyStats(true));
      if(suffix==='lookups')return send(200,{courses:[],subjects:[],batches:[],branches:[],schemaPending:true});
      if(suffix==='next-employee-id')return send(200,{employeeId:null,schemaPending:true});
    }
    safeLog(suffix||'list',error);return send(503,{error:'Staff data is temporarily unavailable. Please retry.'});
  }
}

module.exports={handleStaffRoute,buildStaffListQuery,staffStatsSql};
