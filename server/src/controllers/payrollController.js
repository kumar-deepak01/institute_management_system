'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest, safeEqual } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');
const { calculatePayroll } = require('../services/payrollCalculator');

const cache = new Map();
const CACHE_MS = 12000;
const holidayCache = new Map();
const send = (res, status, value) => json(res, status, value);
const id = () => crypto.randomUUID();
const clean = (value, max = 240) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const amountOk = value => /^\d{1,10}(?:\.\d{1,2})?$/.test(String(value ?? '')) && Number(value) >= 0;
const dateOk = value => {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
};
const requiredPayrollTables = new Set([
  'staff', 'payroll_runs', 'payroll', 'staff_compensation_history', 'payroll_work_records',
  'payroll_adjustments', 'payroll_advances', 'payroll_advance_repayments', 'payroll_audit_events',
]);
function isRequiredPayrollTableMissing(error) {
  if (String(error?.code || '') !== '42P01') return false;
  const relation = String(error?.message || '').match(/relation\s+"(?:public\.)?([a-z_]+)"\s+does not exist/i);
  return Boolean(relation && requiredPayrollTables.has(relation[1].toLowerCase()));
}
function safeError(error) {
  return String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key|credentials|account_number|pan_number)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 300);
}
function log(endpoint, step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  console.error(`[payroll] endpoint=${endpoint} step=${step} code=${code} message=${safeError(error)}`);
}
function cached(key) { const entry = cache.get(key); if (entry && entry.expires > Date.now()) return entry.value; cache.delete(key); return null; }
function invalidate() { cache.clear(); }
function periodFrom(url) {
  const month = Number(url.searchParams.get('month'));
  const year = Number(url.searchParams.get('year'));
  const now = new Date();
  const m = Number.isInteger(month) && month >= 1 && month <= 12 ? month : now.getUTCMonth() + 1;
  const y = Number.isInteger(year) && year >= 2000 && year <= 2200 ? year : now.getUTCFullYear();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = `${y}-${String(m).padStart(2, '0')}-${String(endDate.getUTCDate()).padStart(2, '0')}`;
  return { month: m, year: y, start, end, key: `${y}-${String(m).padStart(2, '0')}` };
}
function countWorkingDays(period, holidayDates = new Set()) {
  let count = 0;
  for (let date = new Date(`${period.start}T00:00:00Z`), end = new Date(`${period.end}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    if (date.getUTCDay() !== 0 && !holidayDates.has(key)) count += 1;
  }
  return count;
}
async function workingDays(period) {
  const cachedValue = holidayCache.get(period.key);
  if (cachedValue && cachedValue.expires > Date.now()) return countWorkingDays(period, cachedValue.dates);
  const { rows } = await queryWithLimit(() => getPool().query(`select record_json->>'startDate' start_date,record_json->>'endDate' end_date,record_json->>'date' single_date,record_json->>'batchId' batch_id from public.app_records where source_tab='Holidays'`));
  const dates = new Set();
  for (const row of rows) {
    if (row.batch_id) continue;
    const from = dateOk(row.start_date) ? row.start_date : dateOk(row.single_date) ? row.single_date : null;
    const to = dateOk(row.end_date) ? row.end_date : from;
    if (!from || !to || from > period.end || to < period.start) continue;
    for (let date = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      const key = date.toISOString().slice(0, 10);
      if (key >= period.start && key <= period.end) dates.add(key);
    }
  }
  holidayCache.set(period.key, { dates, expires: Date.now() + CACHE_MS });
  return countWorkingDays(period, dates);
}
async function authenticate(req) {
  const session = getSession(req);
  if (!session) return { error: 'Sign in required.', status: 401 };
  const account = await resolveSessionAccount(req);
  if (!account) return { error: 'Sign in required.', status: 401 };
  if (account.role !== 'admin') return { error: 'Administrator access is required.', status: 403 };
  return { session, account };
}
async function input(req, res, auth) {
  if (!validCsrfRequest(req, auth.session)) { send(res, 403, { error: 'CSRF validation failed.' }); return null; }
  try { return await body(req, 128 * 1024); } catch { send(res, 400, { error: 'Invalid request body.' }); return null; }
}
async function audit(client, actor, type, details = {}, staffId = null, runId = null, reason = '') {
  await client.query('insert into public.payroll_audit_events(id,actor_id,staff_id,payroll_run_id,event_type,reason,details) values($1,$2,$3,$4,$5,$6,$7::jsonb)',
    [id(), actor.id, staffId, runId, type, clean(reason, 1000), JSON.stringify(details)]);
}
async function markPayrollReview(client, staffId, effectiveDate, reason) {
  await client.query(`update public.payroll_runs r set review_required=true,review_reason=$3,updated_at=now()
    from public.payroll p where p.payroll_run_id=r.id and p.employee_key=$1
      and r.status in ('draft','approved') and $2::date between r.period_start and r.period_end`,
  [staffId, effectiveDate, clean(reason, 300)]);
}

const payrollStaffSql = `select s.id,s.staff_key,s.employee_id,s.name,s.email,s.role,s.staff_type,s.status,s.employment_type,
  s.monthly_salary,s.base_salary,s.per_class_rate,s.hourly_rate,s.pf_percent,s.tds_percent,
  coalesce(sp.account_holder_name,'') account_holder_name,coalesce(sp.bank_name,'') bank_name,coalesce(sp.bank_account_number,'') bank_account_number,coalesce(sp.ifsc_code,'') ifsc_code,coalesce(sp.branch,'') branch,coalesce(sp.upi_id,'') upi_id,coalesce(sp.payment_mode,'both') payment_mode,
  coalesce(ch.compensation_model,case when lower(coalesce(s.employment_type,'')) like '%hourly%' then 'hourly' when lower(coalesce(s.employment_type,'')) like '%contract%' then 'per_class' when lower(coalesce(s.employment_type,'')) like '%hybrid%' or lower(coalesce(s.employment_type,'')) like '%part-time%' then 'hybrid' else 'monthly' end) compensation_model,
  coalesce(ch.monthly_rate,s.monthly_salary,s.base_salary,0)::numeric monthly_rate,
  coalesce(ch.hourly_rate,s.hourly_rate,0)::numeric effective_hourly_rate,
  coalesce(ch.class_rate,s.per_class_rate,0)::numeric class_rate,
  coalesce(ch.teaching_hour_rate,s.hourly_rate,0)::numeric teaching_hour_rate,
  coalesce(ch.allowance,0)::numeric allowance,coalesce(ch.attendance_policy,'{}'::jsonb) attendance_policy,
  coalesce(w.present_days,0)::int present_days,coalesce(w.absent_days,0)::int absent_days,
  coalesce(w.approved_minutes,0)::int approved_minutes,coalesce(w.approved_classes,0)::int approved_classes,
  coalesce(w.pending_records,0)::int pending_records,coalesce(lv.paid_leave_days,0)::int paid_leave_days,coalesce(lv.unpaid_leave_days,0)::int unpaid_leave_days
from public.staff s
left join public.staff_private sp on sp.staff_id=s.id
left join lateral (select h.* from public.staff_compensation_history h where h.staff_id=s.id and h.effective_from<=$2::date and (h.effective_to is null or h.effective_to>=$1::date) order by h.effective_from desc limit 1) ch on true
left join lateral (select (count(*) filter(where record_kind='attendance' and status='approved' and lower(coalesce(record_json->>'attendanceStatus','')) in ('present','late')) + count(*) filter(where record_kind='attendance' and status='approved' and lower(coalesce(record_json->>'attendanceStatus',''))='half_day') * 0.5)::numeric present_days,
  (count(*) filter(where record_kind='attendance' and status='approved' and lower(coalesce(record_json->>'attendanceStatus',''))='absent') + count(*) filter(where record_kind='attendance' and status='approved' and lower(coalesce(record_json->>'attendanceStatus',''))='half_day') * 0.5)::numeric absent_days,
  coalesce(sum(payable_minutes) filter(where record_kind in ('teaching','hourly') and status='approved' and verification_status='verified' and lower(coalesce(record_json->>'attendanceStatus','completed')) not in ('cancelled','rescheduled','no_show','absent','leave')),0)::int approved_minutes,
  count(*) filter(where record_kind='teaching' and status='approved' and verification_status='verified' and lower(coalesce(record_json->>'attendanceStatus',''))='completed' and lower(coalesce(record_json->>'payUnit',''))='class')::int approved_classes,
  count(*) filter(where status='pending' or verification_status in ('pending','ambiguous'))::int pending_records
  from public.payroll_work_records wr where wr.staff_id=s.id and wr.work_date between $1::date and $2::date) w on true
left join lateral (
  select (count(distinct day_row.day) filter(where day_row.paid='true'))::int paid_leave_days,
    (count(distinct day_row.day) filter(where day_row.paid='false'))::int unpaid_leave_days
  from (
    select days.day::date as day,lt.record_json->>'paid' as paid
    from public.app_records request
    join public.app_records lt on lt.source_tab='Leave Types' and lt.record_id=request.record_json->>'typeId'
    cross join lateral generate_series(
      greatest(coalesce(nullif(request.record_json->>'startDate','')::date,nullif(request.record_json->>'date','')::date,$1::date),$1::date)::timestamp,
      least(coalesce(nullif(request.record_json->>'endDate','')::date,nullif(request.record_json->>'date','')::date,$2::date),$2::date)::timestamp,
      interval '1 day') days(day)
    where request.source_tab='Leave Requests' and lower(coalesce(request.record_json->>'status','pending'))='approved'
      and lower(coalesce(request.record_json->>'role','student'))='staff'
      and coalesce(request.record_json->>'personKey',request.record_json->>'staffKey')=s.staff_key::text
      and lt.record_json->>'appliesTo' in ('staff','both')
      and extract(dow from days.day)<>0
      and not exists(select 1 from public.app_records holiday where holiday.source_tab='Holidays' and coalesce(holiday.record_json->>'batchId','')='' and coalesce(nullif(holiday.record_json->>'startDate','')::date,nullif(holiday.record_json->>'date','')::date,'-infinity'::date)<=days.day::date and coalesce(nullif(holiday.record_json->>'endDate','')::date,nullif(holiday.record_json->>'date','')::date,'infinity'::date)>=days.day::date)
      and not exists(select 1 from public.payroll_work_records existing where existing.staff_id=s.id and existing.record_kind='attendance' and existing.status='approved' and existing.work_date=days.day::date)
  ) day_row
) lv on true
where lower(coalesce(s.status,'active')) not in ('inactive','left','terminated','archived')
order by lower(coalesce(s.name,'')),s.id`;

async function loadStaff(period, executor = getPool()) {
  const { rows } = await executor.query(payrollStaffSql, [period.start, period.end]);
  return rows;
}
const payrollBaseStaffSql = `select id,staff_key,employee_id,name,email,role,staff_type,status,employment_type,
  monthly_salary,base_salary,per_class_rate,hourly_rate,pf_percent,tds_percent,
  case when lower(coalesce(employment_type,'')) like '%hourly%' then 'hourly'
    when lower(coalesce(employment_type,'')) like '%contract%' then 'per_class'
    when lower(coalesce(employment_type,'')) like '%hybrid%' or lower(coalesce(employment_type,'')) like '%part-time%' then 'hybrid'
    else 'monthly' end compensation_model,
  coalesce(monthly_salary,base_salary,0)::numeric monthly_rate,
  coalesce(hourly_rate,0)::numeric effective_hourly_rate,
  coalesce(per_class_rate,0)::numeric class_rate,
  coalesce(hourly_rate,0)::numeric teaching_hour_rate,
  0::numeric allowance,'{}'::jsonb attendance_policy,
  0::int present_days,0::int absent_days,0::int approved_minutes,0::int approved_classes,0::int pending_records,
  0::int paid_leave_days,0::int unpaid_leave_days
  from public.staff
  where lower(coalesce(status,'active')) not in ('inactive','left','terminated','archived')
  order by lower(coalesce(name,'')),id`;
function profileConfigured(row) {
  const monthly = Number(row.monthly_rate || 0) > 0;
  const hourly = Number(row.effective_hourly_rate || row.teaching_hour_rate || 0) > 0;
  const perClass = Number(row.class_rate || 0) > 0;
  if (row.compensation_model === 'monthly') return monthly;
  if (row.compensation_model === 'hourly' || row.compensation_model === 'per_hour') return hourly;
  if (row.compensation_model === 'per_class') return perClass;
  if (row.compensation_model === 'hybrid') return monthly && perClass;
  return false;
}
function staffView(row, period, workdays) {
  const profileSet = profileConfigured(row);
  const preview = calculatePayroll({
    model: row.compensation_model, monthlyRate: row.monthly_rate, hourlyRate: row.effective_hourly_rate, pfPercent: row.pf_percent, tdsPercent: row.tds_percent,
    teachingHourRate: row.teaching_hour_rate, classRate: row.class_rate, allowance: row.allowance,
    workingDays: workdays, unpaidAbsenceDays: Number(row.absent_days || 0) + Number(row.unpaid_leave_days || 0), attendancePolicy: row.attendance_policy,
    approvedMinutes: row.approved_minutes, approvedClasses: row.approved_classes,
  });
  const dayCount = Number(row.present_days || 0) + Number(row.absent_days || 0);
  const hasPaymentDetails = Boolean(row.bank_account_number || row.upi_id);
  const paymentDetails = {
    paymentMode: row.payment_mode || 'both',
    accountHolderName: row.account_holder_name || '',
    bankName: row.bank_name || '',
    bankAccountNumber: row.bank_account_number || '',
    ifscCode: row.ifsc_code || '',
    branch: row.branch || '',
    upiId: row.upi_id || ''
  };
  return { id: row.id, staffKey: row.staff_key, employeeId: row.employee_id || '', name: row.name || '', email: row.email || '', role: row.role || row.staff_type || 'Staff', employmentType: row.employment_type || '', model: row.compensation_model, profileSet,
    monthlyRate: Number(row.monthly_rate || 0), hourlyRate: Number(row.effective_hourly_rate || 0), classRate: Number(row.class_rate || 0), teachingHourRate: Number(row.teaching_hour_rate || 0), allowance: Number(row.allowance || 0),
    presentDays: Number(row.present_days || 0), absentDays: Number(row.absent_days || 0), paidLeaveDays: Number(row.paid_leave_days || 0), unpaidLeaveDays: Number(row.unpaid_leave_days || 0), recordedAttendanceDays: dayCount,
    attendancePercent: dayCount ? Math.round(Number(row.present_days || 0) * 100 / dayCount) : null,
    approvedMinutes: Number(row.approved_minutes || 0), payableHours: Number(row.approved_minutes || 0) / 60, approvedClasses: Number(row.approved_classes || 0), pendingWorkRecords: Number(row.pending_records || 0),
    hasPaymentDetails, paymentDetails, ...preview, period: period.key };
}
async function adjustmentsByStaff(period, executor = getPool()) {
  const { rows } = await executor.query(`select staff_id,kind,label,amount,reason,id from public.payroll_adjustments where period_start=$1::date and period_end=$2::date and status='approved' and payroll_id is null order by staff_id,created_at,id`, [period.start, period.end]);
  const grouped = new Map();
  for (const row of rows) { const current = grouped.get(row.staff_id) || { earnings: [], deductions: [] }; current[row.kind === 'earning' ? 'earnings' : 'deductions'].push({ id: row.id, label: row.label, amount: Number(row.amount), reason: row.reason }); grouped.set(row.staff_id, current); }
  return grouped;
}
async function advancesByStaff(executor = getPool()) {
  const { rows } = await executor.query(`select a.id,a.staff_id,a.amount,a.repayment_amount,a.reason,a.status,a.requested_date,
    coalesce(sum(r.amount),0)::numeric recovered, greatest(a.amount-coalesce(sum(r.amount),0),0)::numeric balance
    from public.payroll_advances a left join public.payroll_advance_repayments r on r.advance_id=a.id
    where a.status='approved' group by a.id order by a.requested_date,a.id`);
  const grouped = new Map();
  for (const row of rows) { const list = grouped.get(row.staff_id) || []; list.push({ id: row.id, amount: Number(row.amount), repaymentAmount: Number(row.repayment_amount), balance: Number(row.balance), reason: row.reason }); grouped.set(row.staff_id, list); }
  return grouped;
}
function addExtras(row, extras = { earnings: [], deductions: [] }, advances = []) {
  const advancesRecovery = advances.reduce((sum, item) => sum + Math.min(item.balance, item.repaymentAmount), 0);
  return calculatePayroll({ model: row.compensation_model, monthlyRate: row.monthly_rate, hourlyRate: row.effective_hourly_rate, pfPercent: row.pf_percent, tdsPercent: row.tds_percent, teachingHourRate: row.teaching_hour_rate, classRate: row.class_rate, allowance: row.allowance,
    workingDays: row._workingDays, unpaidAbsenceDays: Number(row.absent_days || 0) + Number(row.unpaid_leave_days || 0), attendancePolicy: row.attendance_policy, approvedMinutes: row.approved_minutes, approvedClasses: row.approved_classes,
    earnings: extras.earnings, deductions: extras.deductions, advanceRecovery: advancesRecovery });
}
function payrollStatus(run) { return run?.status || 'not_generated'; }
function emptyDashboard(period, schemaPending = false) {
  return { period, stats: { totalStaff: 0, profilesSetUp: 0, workingDays: countWorkingDays(period), settledAmount: 0 }, run: null, staff: [], history: [], advances: [], zoom: { configured: false, webhookReady: Boolean(process.env.ZOOM_WEBHOOK_SECRET_TOKEN) }, schemaPending };
}
async function dashboard(res, period, fresh) {
  const key = `dashboard:${period.key}`;
  if (!fresh) { const value = cached(key); if (value) return send(res, 200, value); }
  const pool = getPool();
  let schemaPending = false;
  const safePanel = async (step, task, fallback) => {
    try { return await queryWithLimit(task); }
    catch (error) { log('/api/admin/payroll', step, error); if (isRequiredPayrollTableMissing(error)) schemaPending = true; return fallback; }
  };
  let staffRows = [], rosterResult;
  try {
    rosterResult = await safePanel('load staff payroll and attendance details', () => loadStaff(period, pool), null);
    if (rosterResult) staffRows = rosterResult;
    else staffRows = (await safePanel('load base staff roster', () => pool.query(payrollBaseStaffSql), { rows: [] })).rows || [];
  } catch (error) {
    log('/api/admin/payroll', 'load base staff roster', error);
    if (isRequiredPayrollTableMissing(error)) schemaPending = true;
  }
  const [runResult, historyResult, advanceResult, zoomResult, workdaysResult] = await Promise.all([
    safePanel('load current payroll run', () => pool.query(`select r.*,count(p.id)::int staff_count from public.payroll_runs r left join public.payroll p on p.payroll_run_id=r.id where r.period_start=$1::date and r.period_end=$2::date group by r.id`, [period.start, period.end]), { rows: [] }),
    safePanel('load payroll history', () => pool.query(`select r.id,r.period_start,r.period_end,r.status,r.gross_total,r.deduction_total,r.net_total,r.settled_at,count(p.id)::int staff_count from public.payroll_runs r left join public.payroll p on p.payroll_run_id=r.id group by r.id order by r.period_start desc limit 18`), { rows: [] }),
    safePanel('load approved advances', () => advancesByStaff(pool), new Map()),
    safePanel('load Zoom connection status', () => pool.query(`select connected from public.integration_connections where provider='zoom' limit 1`), { rows: [] }),
    safePanel('load holiday calendar', () => workingDays(period), countWorkingDays(period)),
  ]);
  const workdays = Number.isFinite(workdaysResult) ? workdaysResult : countWorkingDays(period);
  const staff = (Array.isArray(staffRows) ? staffRows : []).map(row => staffView(row, period, workdays));
  const run = runResult?.rows?.[0] || null;
  const history = (historyResult?.rows || []).map(row => ({ id: row.id, periodStart: String(row.period_start).slice(0, 10), periodEnd: String(row.period_end).slice(0, 10), status: row.status, staffCount: Number(row.staff_count || 0), grossTotal: Number(row.gross_total || 0), deductionTotal: Number(row.deduction_total || 0), netTotal: Number(row.net_total || 0), settledAt: row.settled_at }));
  const advances = Array.from(advanceResult instanceof Map ? advanceResult : [], ([staffId, list]) =>
    (Array.isArray(list) ? list : []).map(item => ({ ...item, staffId }))
  ).flat();
  const result = { period, stats: { totalStaff: staff.length, profilesSetUp: staff.filter(row => row.profileSet).length, workingDays: workdays, settledAmount: run?.status === 'settled' ? Number(run.net_total || 0) : 0 }, run: run ? { id: run.id, status: payrollStatus(run), reviewRequired: Boolean(run.review_required), reviewReason: run.review_reason || '', staffCount: Number(run.staff_count || 0), grossTotal: Number(run.gross_total || 0), deductionTotal: Number(run.deduction_total || 0), netTotal: Number(run.net_total || 0), approvedAt: run.approved_at, finalizedAt: run.finalized_at, settledAt: run.settled_at, paymentDate: run.payment_date } : null,
    staff, history, advances, zoom: { configured: Boolean(zoomResult?.rows?.[0]?.connected), webhookReady: Boolean(process.env.ZOOM_WEBHOOK_SECRET_TOKEN) }, schemaPending };
  cache.set(key, { value: result, expires: Date.now() + CACHE_MS });
  return send(res, 200, result);
}

function csvCell(value) { const text = String(value ?? ''); const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; }
function csvResponse(res, rows, filename) {
  const columns = ['Period','Employee ID','Name','Employment Type','Attendance Days','Payable Hours','Gross Pay','Deductions','Net Pay','Status'];
  const csv = [columns, ...rows.map(row => [row.period || row.periodStart, row.employeeId, row.name, row.employmentType, row.attendanceDays, row.payableHours, row.grossPay, row.deductions, row.netPay, row.status])].map(line => line.map(csvCell).join(',')).join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.end(`\uFEFF${csv}`);
}
function pdfText(value) { return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&').slice(0, 150); }
function createPayslipPdf(run, record) {
  const snapshot = record.snapshot_json || {};
  const calculation = snapshot.calculation || record.breakdown_json || {};
  const period = run.period_start ? new Date(`${String(run.period_start).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Payroll period';
  const money = value => `INR ${Number(value || 0).toFixed(2)}`;
  const lines = [
    'My JEE Mentor - Staff Payslip',
    `Period: ${period}    Status: ${record.status || run.status}`,
    `Staff: ${snapshot.name || record.name || 'Staff'}    Employee ID: ${snapshot.employeeId || record.employee_id || '-'}`,
    `Employment: ${snapshot.employmentType || '-'}    Model: ${snapshot.model || '-'}`,
    `Present days: ${Number(snapshot.presentDays || record.attendance_days || 0)}    Absent days: ${Number(snapshot.absentDays || 0)}`,
    `Approved teaching time: ${(Number(snapshot.approvedMinutes || (Number(record.payable_hours || 0) * 60)) / 60).toFixed(2)} hours    Approved classes: ${Number(snapshot.approvedClasses || 0)}`,
    `Base earnings: ${money(calculation.baseEarnings)}    Teaching earnings: ${money(calculation.teachingEarnings)}`,
    `Allowances: ${money(calculation.allowances)}    Other earnings: ${money(calculation.otherEarnings)}`,
    `Gross pay: ${money(record.gross_pay)}`,
    `PF (${Number(snapshot.pfPercent || 0)}%): ${money(calculation.pfDeduction)}`,
    `TDS (${Number(snapshot.tdsPercent || 0)}%): ${money(calculation.tdsDeduction)}`,
    `Other deductions: ${money(calculation.otherDeductions)}    Advance recovery: ${money(calculation.advanceRecovery)}`,
    `Deductions: ${money(record.deductions)}`,
    `Net pay: ${money(record.net_pay)}`,
    'This payslip reflects the saved payroll snapshot for this period.',
  ];
  const commands = ['BT', '/F1 16 Tf', '50 790 Td', `(${pdfText(lines[0])}) Tj`, '/F1 10 Tf'];
  for (const line of lines.slice(1)) commands.push('0 -28 Td', `(${pdfText(line)}) Tj`);
  commands.push('ET');
  const stream = Buffer.from(commands.join('\n'), 'ascii');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream.toString('ascii')}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = [0]; let position = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(position);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'binary'); chunks.push(chunk); position += chunk.length;
  });
  const xrefStart = position;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)];
  chunks.push(Buffer.from(`${xref.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`, 'ascii'));
  return Buffer.concat(chunks);
}
function createZipArchive(entries) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; }
  const crc32 = buffer => { let crc = 0xFFFFFFFF; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8); return (crc ^ 0xFFFFFFFF) >>> 0; };
  const localParts = [], centralParts = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/[^A-Za-z0-9_.-]/g, '_'), 'ascii');
    const body = zlib.deflateRawSync(entry.data); const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    localParts.push(local, body);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014B50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); name.copy(central, 46);
    centralParts.push(central); offset += local.length + body.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}
function fileResponse(res, data, contentType, filename) {
  res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  return res.end(data);
}

async function loadStaffAttendance(period) {
  const endpoint = '/api/admin/payroll/staff-attendance';
  const { rows: roster } = await queryWithLimit(() => getPool().query(`select id,staff_key,employee_id,name,email,staff_type,role,employment_type
    from public.staff where lower(coalesce(status,'active')) not in ('inactive','left','terminated','archived')
    order by lower(coalesce(name,'')),id`));
  const staffIds = roster.map(row => row.id);
  let attendanceRows = [], schemaPending = false;
  if (staffIds.length) {
    try {
      const result = await queryWithLimit(() => getPool().query(`select staff_id,work_date,record_json,minutes,status record_status
        from public.payroll_work_records
        where staff_id=any($1::text[]) and record_kind='attendance' and source='manual' and work_date between $2::date and $3::date
        order by staff_id,work_date`, [staffIds, period.start, period.end]));
      attendanceRows = result.rows || [];
    } catch (error) { log(endpoint, 'load attendance work records', error); if (isRequiredPayrollTableMissing(error)) schemaPending = true; }
  }
  let workdays;
  try { workdays = await workingDays(period); }
  catch (error) { log(endpoint, 'load holiday calendar', error); workdays = countWorkingDays(period); if (isRequiredPayrollTableMissing(error)) schemaPending = true; }
  const byStaff = new Map();
  for (const row of roster) byStaff.set(row.id, { id: row.id, staffKey: row.staff_key, employeeId: row.employee_id || '', name: row.name || '', email: row.email || '', type: row.staff_type || row.role || 'Staff', employmentType: row.employment_type || '', days: {} });
  for (const row of attendanceRows) {
    const staff = byStaff.get(row.staff_id);
    if (!staff) continue;
    if (!row.work_date) continue;
    const date = String(row.work_date).slice(0, 10);
    const record = row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
    staff.days[date] = { status: clean(record.attendanceStatus, 20).toLowerCase() || 'absent', checkIn: clean(record.checkIn, 5), checkOut: clean(record.checkOut, 5), minutes: Number(row.minutes || 0), overtimeMinutes: Number(record.overtimeMinutes || 0), recordStatus: row.record_status || '' };
  }
  const staff = [...byStaff.values()];
  let presentEquivalent = 0, lateCheckIns = 0, overtimeMinutes = 0;
  for (const person of staff) for (const record of Object.values(person.days)) {
    if (record.status === 'present' || record.status === 'late') presentEquivalent += 1;
    else if (record.status === 'half_day') presentEquivalent += 0.5;
    if (record.status === 'late') lateCheckIns += 1;
    overtimeMinutes += Number(record.overtimeMinutes || 0);
  }
  const scheduledDays = staff.length * workdays;
  return { period, workdays, staff, stats: { totalStaff: staff.length, avgAttendance: scheduledDays ? Math.round(presentEquivalent * 1000 / scheduledDays) / 10 : 0, lateCheckIns, overtimeHours: Math.round(overtimeMinutes / 6) / 10 }, schemaPending };
}

function staffAttendanceCsv(data) {
  const rows = [['Date','Staff Member','Employee ID','Type','Employment','Status','Check In','Check Out','Working Hours','Overtime Hours']];
  for (const person of data.staff) {
    for (let day = 1; day <= Number(data.period.end.slice(8, 10)); day += 1) {
      const date = `${data.period.key}-${String(day).padStart(2, '0')}`;
      const entry = person.days[date] || { status: 'unmarked', checkIn: '', checkOut: '', minutes: 0, overtimeMinutes: 0 };
      rows.push([date, person.name, person.employeeId, person.type, person.employmentType, entry.status, entry.checkIn, entry.checkOut, (Number(entry.minutes) / 60).toFixed(2), (Number(entry.overtimeMinutes) / 60).toFixed(2)]);
    }
  }
  const cell = value => { const text = String(value ?? ''); const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; };
  return `\uFEFF${rows.map(row => row.map(cell).join(',')).join('\r\n')}`;
}

async function saveStaffAttendance(req, res, auth, date) {
  const data = await input(req, res, auth); if (!data) return;
  if (!dateOk(date) || !Array.isArray(data.records) || data.records.length > 500) return send(res, 400, { error: 'Choose a valid date and provide up to 500 staff attendance records.' });
  const allowed = new Set(['present','late','half_day','leave','absent','holiday']);
  const records = data.records.map(row => ({ staffId: clean(row.staffId, 120), status: clean(row.status, 20).toLowerCase(), checkIn: clean(row.checkIn, 5), checkOut: clean(row.checkOut, 5), overtimeMinutes: Number(row.overtimeMinutes || 0) }));
  if (records.some(row => !row.staffId || !allowed.has(row.status) || (row.checkIn && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.checkIn)) || (row.checkOut && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.checkOut)) || !Number.isInteger(row.overtimeMinutes) || row.overtimeMinutes < 0 || row.overtimeMinutes > 1440)) return send(res, 400, { error: 'Check each staff member, attendance status, time and overtime value.' });
  if (new Set(records.map(row => row.staffId)).size !== records.length) return send(res, 400, { error: 'A staff member can appear only once for this date.' });
  const minutesFor = row => {
    if (!row.checkIn || !row.checkOut) return 0;
    let value = Number(row.checkOut.slice(0, 2)) * 60 + Number(row.checkOut.slice(3)) - Number(row.checkIn.slice(0, 2)) * 60 - Number(row.checkIn.slice(3));
    if (value < 0) value += 1440;
    return value;
  };
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const saved = await client.query(`with incoming as (
      select * from jsonb_to_recordset($1::jsonb) as x(staff_id text,status text,check_in text,check_out text,overtime_minutes integer,minutes integer)
    ) insert into public.payroll_work_records(id,staff_id,work_date,record_kind,source,verification_status,status,minutes,payable_minutes,record_json,created_by)
      select gen_random_uuid()::text,s.id,$2::date,'attendance','manual','verified','approved',i.minutes,i.minutes,
        jsonb_build_object('attendanceStatus',i.status,'checkIn',i.check_in,'checkOut',i.check_out,'overtimeMinutes',i.overtime_minutes),$3
      from incoming i join public.staff s on s.id=i.staff_id
      on conflict(staff_id,work_date) where record_kind='attendance' and source='manual'
      do update set verification_status='verified',status='approved',minutes=excluded.minutes,payable_minutes=excluded.payable_minutes,record_json=excluded.record_json,created_by=excluded.created_by
      returning staff_id`, [JSON.stringify(records.map(row => ({ staff_id: row.staffId, status: row.status, check_in: row.checkIn, check_out: row.checkOut, overtime_minutes: row.overtimeMinutes, minutes: minutesFor(row) }))), date, auth.account.id]);
    if ((saved.rowCount || 0) !== records.length) { await client.query('rollback'); return send(res, 404, { error: 'One or more staff members could not be found.' }); }
    await client.query(`update public.payroll_runs r set review_required=true,review_reason='Staff attendance changed after payroll generation.',updated_at=now()
      from public.payroll p where p.payroll_run_id=r.id and p.employee_key=any($1::text[]) and $2::date between r.period_start and r.period_end and r.status in ('draft','approved')`, [records.map(row => row.staffId), date]);
    await client.query(`insert into public.payroll_audit_events(id,actor_id,staff_id,event_type,reason,details)
      select gen_random_uuid()::text,$1,x.staff_id,'attendance.marked','Staff attendance saved from the attendance workspace.',jsonb_build_object('date',$2::text,'status',x.status)
      from jsonb_to_recordset($3::jsonb) as x(staff_id text,status text)`, [auth.account.id, date, JSON.stringify(records.map(row => ({ staff_id: row.staffId, status: row.status })))]);
    await client.query('commit');
    invalidate();
    return send(res, 200, { saved: saved.rowCount || 0, date });
  } catch (error) {
    try { await client.query('rollback'); } catch {}
    throw error;
  } finally { client.release(); }
}

async function handlePayrollRoute(req, res, url) {
  const pathname = url.pathname;
  if (pathname === '/api/webhooks/zoom' && req.method === 'POST') return handleZoomWebhook(req, res);
  if (!pathname.startsWith('/api/admin/payroll')) return null;
  let auth;
  try { auth = await authenticate(req); } catch (error) { log(pathname, 'authenticate administrator', error); return send(res, 503, { error: 'Administrator session could not be verified.' }); }
  if (auth.error) return send(res, auth.status, { error: auth.error });
  const period = periodFrom(url);
  try {
    if (req.method === 'GET' && pathname === '/api/admin/payroll/staff-attendance') {
      try { const value = await loadStaffAttendance(period); return send(res, 200, value); }
      catch (error) { if (!isRequiredPayrollTableMissing(error)) throw error; log(pathname, 'load attendance and staff roster', error); return send(res, 200, { period, workdays: countWorkingDays(period), staff: [], stats: { totalStaff: 0, avgAttendance: 0, lateCheckIns: 0, overtimeHours: 0 }, schemaPending: true }); }
    }
    if (req.method === 'GET' && pathname === '/api/admin/payroll/staff-attendance/report.csv') {
      try { const value = await loadStaffAttendance(period); const csv = Buffer.from(staffAttendanceCsv(value), 'utf8'); return fileResponse(res, csv, 'text/csv; charset=utf-8', `staff-attendance-${period.key}.csv`); }
      catch (error) { if (isRequiredPayrollTableMissing(error)) { log(pathname, 'prepare attendance report', error); return send(res, 503, { error: 'Staff attendance storage is not available yet.', schemaPending: true }); } throw error; }
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/staff-attendance') {
      try { return await saveStaffAttendance(req, res, auth, clean(url.searchParams.get('date'), 10)); }
      catch (error) { if (isRequiredPayrollTableMissing(error)) { log(pathname, 'save attendance records', error); return send(res, 503, { error: 'Staff attendance storage is not available yet.', schemaPending: true }); } throw error; }
    }
    if (req.method === 'GET' && pathname === '/api/admin/payroll') return await dashboard(res, period, url.searchParams.get('fresh') === '1');
    if (req.method === 'GET' && (pathname === '/api/admin/payroll/export.csv' || pathname === '/api/admin/payroll/history.csv')) {
      const runId = clean(url.searchParams.get('runId'), 120);
      const allHistory = pathname.endsWith('/history.csv');
      const { rows } = await queryWithLimit(() => getPool().query(`select r.period_start,p.employee_id,coalesce(s.name,'') name,coalesce(s.employment_type,'') employment_type,p.attendance_days,p.payable_hours,coalesce(p.gross_pay,p.amount,0)::numeric gross_pay,coalesce(p.deductions,0)::numeric deductions,coalesce(p.net_pay,p.amount,0)::numeric net_pay,p.status from public.payroll p join public.payroll_runs r on r.id=p.payroll_run_id left join public.staff s on s.id=p.employee_key where ($1='' or p.payroll_run_id=$1) and ($2::boolean or r.period_start=$3::date) order by r.period_start desc,s.name,p.employee_id limit 20000`, [runId, allHistory, period.start]));
      return csvResponse(res, rows.map(row => ({ ...row, period: String(row.period_start).slice(0, 7), employeeId: row.employee_id, employmentType: row.employment_type, attendanceDays: Number(row.attendance_days || 0), payableHours: Number(row.payable_hours || 0), grossPay: Number(row.gross_pay || 0), deductions: Number(row.deductions || 0), netPay: Number(row.net_pay || 0) })), allHistory ? 'payroll-history.csv' : `payroll-${period.key}.csv`);
    }
    if (req.method === 'GET' && pathname === '/api/admin/payroll/advances') {
      const { rows } = await queryWithLimit(() => getPool().query(`select a.id,a.staff_id,s.staff_key,s.name,s.employee_id,a.amount,a.repayment_amount,a.reason,a.requested_date,a.status,a.approved_at,coalesce(sum(r.amount),0)::numeric recovered,greatest(a.amount-coalesce(sum(r.amount),0),0)::numeric balance from public.payroll_advances a join public.staff s on s.id=a.staff_id left join public.payroll_advance_repayments r on r.advance_id=a.id group by a.id,s.id order by a.requested_date desc,a.id`));
      return send(res, 200, { records: rows.map(row => ({ id: row.id, staffId: row.staff_id, staffKey: row.staff_key, name: row.name, employeeId: row.employee_id, amount: Number(row.amount), repaymentAmount: Number(row.repayment_amount), recovered: Number(row.recovered), balance: Number(row.balance), reason: row.reason, requestedDate: String(row.requested_date).slice(0, 10), status: row.status, approvedAt: row.approved_at })), schemaPending: false });
    }
    if (req.method === 'GET' && pathname === '/api/admin/payroll/history') {
      const { rows } = await queryWithLimit(() => getPool().query(`select r.id,r.period_start,r.period_end,r.status,r.gross_total,r.deduction_total,r.net_total,r.approved_at,r.finalized_at,r.settled_at,count(p.id)::int staff_count from public.payroll_runs r left join public.payroll p on p.payroll_run_id=r.id group by r.id order by r.period_start desc limit 100`));
      return send(res, 200, { records: rows.map(row => ({ id: row.id, periodStart: String(row.period_start).slice(0, 10), periodEnd: String(row.period_end).slice(0, 10), status: row.status, grossTotal: Number(row.gross_total), deductionTotal: Number(row.deduction_total), netTotal: Number(row.net_total), staffCount: Number(row.staff_count), approvedAt: row.approved_at, finalizedAt: row.finalized_at, settledAt: row.settled_at })) });
    }
    const runDetailMatch = pathname.match(/^\/api\/admin\/payroll\/runs\/([^/]+)$/);
    if (req.method === 'GET' && runDetailMatch) {
      const [runResult, rowsResult] = await Promise.all([
        queryWithLimit(() => getPool().query('select * from public.payroll_runs where id=$1', [decodeURIComponent(runDetailMatch[1])])),
        queryWithLimit(() => getPool().query(`select p.id,p.employee_id,p.employee_key,p.status,p.gross_pay,p.deductions,p.net_pay,p.attendance_days,p.payable_hours,p.breakdown_json,p.snapshot_json,s.name,s.employee_id staff_employee_id,s.employment_type from public.payroll p left join public.staff s on s.id=p.employee_key where p.payroll_run_id=$1 order by s.name,p.employee_id`, [decodeURIComponent(runDetailMatch[1])])),
      ]);
      const r = runResult.rows[0]; if (!r) return send(res, 404, { error: 'Payroll run not found.' });
      return send(res, 200, { run: { id: r.id, periodStart: String(r.period_start).slice(0, 10), periodEnd: String(r.period_end).slice(0, 10), status: r.status, grossTotal: Number(r.gross_total), deductionTotal: Number(r.deduction_total), netTotal: Number(r.net_total), approvedAt: r.approved_at, finalizedAt: r.finalized_at, settledAt: r.settled_at, paymentDate: r.payment_date, paymentReference: r.payment_reference, paymentMethod: r.payment_method }, records: rowsResult.rows.map(row => ({ id: row.id, staffId: row.employee_key, employeeId: row.staff_employee_id || row.employee_id, name: row.name || row.snapshot_json?.name || '', employmentType: row.employment_type || row.snapshot_json?.employmentType || '', status: row.status, grossPay: Number(row.gross_pay ?? row.amount ?? 0), deductions: Number(row.deductions || 0), netPay: Number(row.net_pay ?? row.amount ?? 0), attendanceDays: Number(row.attendance_days || 0), payableHours: Number(row.payable_hours || 0), breakdown: row.breakdown_json || {}, snapshot: row.snapshot_json || {} })) });
    }
    const payslipMatch = pathname.match(/^\/api\/admin\/payroll\/runs\/([^/]+)\/payslips\/([^/]+)$/);
    if (req.method === 'GET' && payslipMatch) {
      const runId = decodeURIComponent(payslipMatch[1]), staffId = decodeURIComponent(payslipMatch[2]);
      const { rows } = await queryWithLimit(() => getPool().query(`select r.period_start,r.period_end,r.status run_status,p.id,p.status,p.employee_id,p.employee_key,p.gross_pay,p.deductions,p.net_pay,p.attendance_days,p.payable_hours,p.snapshot_json,p.breakdown_json
        from public.payroll_runs r join public.payroll p on p.payroll_run_id=r.id where r.id=$1 and p.employee_key=$2`, [runId, staffId]));
      if (!rows[0]) return send(res, 404, { error: 'No saved payroll record exists for that staff member and run.' });
      const row = rows[0];
      return fileResponse(res, createPayslipPdf({ period_start: row.period_start, period_end: row.period_end, status: row.run_status }, row), 'application/pdf', `payslip-${row.id}.pdf`);
    }
    const payslipsZipMatch = pathname.match(/^\/api\/admin\/payroll\/runs\/([^/]+)\/payslips\.zip$/);
    if (req.method === 'GET' && payslipsZipMatch) {
      const runId = decodeURIComponent(payslipsZipMatch[1]);
      const { rows } = await queryWithLimit(() => getPool().query(`select r.period_start,r.period_end,r.status run_status,p.id,p.status,p.employee_id,p.employee_key,p.gross_pay,p.deductions,p.net_pay,p.attendance_days,p.payable_hours,p.snapshot_json,p.breakdown_json
        from public.payroll_runs r join public.payroll p on p.payroll_run_id=r.id where r.id=$1 order by p.snapshot_json->>'name',p.employee_id`, [runId]));
      if (!rows.length) return send(res, 404, { error: 'No saved payroll records exist for that run.' });
      const run = { period_start: rows[0].period_start, period_end: rows[0].period_end, status: rows[0].run_status };
      const files = rows.map(row => ({ name: `payslip-${row.id}.pdf`, data: createPayslipPdf(run, row) }));
      return fileResponse(res, createZipArchive(files), 'application/zip', `payslips-${String(run.period_start).slice(0, 7)}.zip`);
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/runs/preview') {
      const data = await input(req, res, auth); if (!data) return;
      const selected = data.period && dateOk(`${data.period}-01`) ? periodFrom(new URL(`http://local/?month=${Number(data.period.slice(5,7))}&year=${Number(data.period.slice(0,4))}`)) : period;
      const [staffRows, extras, advances] = await Promise.all([queryWithLimit(() => loadStaff(selected)), queryWithLimit(() => adjustmentsByStaff(selected)), queryWithLimit(() => advancesByStaff())]);
      const workdays = await workingDays(selected);
      const rowsList = Array.isArray(staffRows) ? staffRows : (staffRows?.rows || []);
      const records = rowsList.map(row => {
        const item = staffView(row, selected, workdays); const extended = addExtras({ ...row, _workingDays: workdays }, extras.get(row.id), advances.get(row.id) || []);
        return { ...item, ...extended, eligible: item.profileSet && item.pendingWorkRecords === 0, warnings: [...(!item.profileSet ? ['Compensation profile is not configured.'] : []), ...(item.pendingWorkRecords ? [`${item.pendingWorkRecords} work or attendance records need review.`] : []), ...(!item.hasPaymentDetails ? ['Payment details (Bank Account or UPI) are missing.'] : [])] };
      });
      return send(res, 200, { period: selected, workingDays: workdays, records, totals: { staff: records.filter(row => row.eligible).length, gross: records.reduce((n, row) => n + row.grossPay, 0), deductions: records.reduce((n, row) => n + row.totalDeductions, 0), net: records.reduce((n, row) => n + row.netPay, 0) } });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/runs') {
      const data = await input(req, res, auth); if (!data) return;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(data.period || ''))) return send(res, 400, { error: 'Choose a valid payroll month and year.' });
      const selected = periodFrom(new URL(`http://local/?month=${Number(data.period.slice(5,7))}&year=${Number(data.period.slice(0,4))}`));
      if (selected.start !== period.start || selected.end !== period.end) return send(res, 400, { error: 'Generate payroll for the selected month and year.' });
      const client = await getPool().connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [selected.key]);
        const existing = await client.query('select id,status from public.payroll_runs where period_start=$1::date and period_end=$2::date for update', [selected.start, selected.end]);
        const existingRun = existing.rows[0] || null;
        if (existingRun && existingRun.status === 'settled' && !data.confirmSettledOverwrite) {
          await client.query('rollback');
          return send(res, 409, { error: `Payroll for ${selected.key} has already been marked as Settled. Confirm to recalculate and overwrite.`, settled: true, runId: existingRun.id });
        }
        const requestedStaffId = clean(data.staffId, 120);
        const [staffRows, extras, advances] = await Promise.all([loadStaff(selected, client), adjustmentsByStaff(selected, client), advancesByStaff(client)]);
        const workdays = await workingDays(selected);
        const runId = existingRun?.id || id();
        const eligibleRows = staffRows.filter(row => staffView(row, selected, workdays).profileSet && Number(row.pending_records || 0) === 0);

        let requestedIds = [];
        if (Array.isArray(data.staffIds) && data.staffIds.length) {
          requestedIds = data.staffIds.map(String).map(s => clean(s, 120)).filter(Boolean);
        } else if (Array.isArray(data.includeStaffIds) && data.includeStaffIds.length) {
          requestedIds = data.includeStaffIds.map(String).map(s => clean(s, 120)).filter(Boolean);
        } else if (requestedStaffId) {
          requestedIds = [requestedStaffId];
        } else {
          requestedIds = eligibleRows.map(row => row.id);
        }

        if (requestedIds.length > 0 && requestedIds.some(staffId => !staffRows.some(row => row.id === staffId))) {
          await client.query('rollback');
          return send(res, 404, { error: 'One or more selected staff members could not be found.' });
        }
        const eligibleRequested = requestedIds.filter(staffId => eligibleRows.some(row => row.id === staffId));
        if (!eligibleRequested.length) {
          await client.query('rollback');
          return send(res, 400, { error: 'No selected staff members have a configured compensation profile with approved work records for this period.' });
        }
        const includeIds = new Set(eligibleRequested);
        const excludedStaff = staffRows.filter(row => !includeIds.has(row.id)).map(row => {
          const view = staffView(row, selected, workdays);
          return { staffId: row.id, name: row.name || '', reason: !view.profileSet ? 'Compensation profile is not configured.' : view.pendingWorkRecords ? 'Work or attendance records need review.' : requestedIds.length < staffRows.length ? 'Not selected for this payroll.' : 'Not selected for this payroll.' };
        });

        if (!existingRun) {
          await client.query(`insert into public.payroll_runs(id,period_start,period_end,status,generated_by,record_json) values($1,$2::date,$3::date,'draft',$4,$5::jsonb)`, [runId, selected.start, selected.end, auth.account.id, JSON.stringify({ warningsAccepted: Boolean(data.confirmWarnings), excludedStaff })]);
        }

        let saved = 0;
        for (const row of staffRows) {
          if (!includeIds.has(row.id)) continue;
          const rowsExtras = extras.get(row.id) || { earnings: [], deductions: [] };
          const staffAdvances = advances.get(row.id) || [];
          const recoveryParts = staffAdvances.map(advance => ({ advanceId: advance.id, amount: Math.min(advance.balance, advance.repaymentAmount) })).filter(x => x.amount > 0);
          const recovery = recoveryParts.reduce((n, x) => n + x.amount, 0);
          const calc = calculatePayroll({ model: row.compensation_model, monthlyRate: row.monthly_rate, hourlyRate: row.effective_hourly_rate, pfPercent: row.pf_percent, tdsPercent: row.tds_percent, teachingHourRate: row.teaching_hour_rate, classRate: row.class_rate, allowance: row.allowance, workingDays: workdays, unpaidAbsenceDays: Number(row.absent_days || 0) + Number(row.unpaid_leave_days || 0), attendancePolicy: row.attendance_policy, approvedMinutes: row.approved_minutes, approvedClasses: row.approved_classes, earnings: rowsExtras.earnings, deductions: rowsExtras.deductions, advanceRecovery: recovery });
          const payrollId = id();
          const snapshot = { staffId: row.id, staffKey: row.staff_key, employeeId: row.employee_id, name: row.name, role: row.role || row.staff_type, employmentType: row.employment_type, model: row.compensation_model, monthlyRate: Number(row.monthly_rate), hourlyRate: Number(row.effective_hourly_rate), classRate: Number(row.class_rate), teachingHourRate: Number(row.teaching_hour_rate), allowance: Number(row.allowance), pfPercent: Number(row.pf_percent || 0), tdsPercent: Number(row.tds_percent || 0), attendancePolicy: row.attendance_policy, presentDays: Number(row.present_days), absentDays: Number(row.absent_days), paidLeaveDays: Number(row.paid_leave_days || 0), unpaidLeaveDays: Number(row.unpaid_leave_days || 0), approvedMinutes: Number(row.approved_minutes), approvedClasses: Number(row.approved_classes), adjustments: rowsExtras, advances: recoveryParts, paymentDetails: { paymentMode: row.payment_mode || 'both', accountHolderName: row.account_holder_name || '', bankName: row.bank_name || '', bankAccountNumber: row.bank_account_number || '', ifscCode: row.ifsc_code || '', branch: row.branch || '', upiId: row.upi_id || '' }, calculation: calc };

          // Replace/update this specific staff row in payroll without wiping out others
          const prevRows = await client.query('select id from public.payroll where payroll_run_id=$1 and employee_key=$2', [runId, row.id]);
          for (const prev of prevRows.rows) {
            await client.query('delete from public.payroll_advance_repayments where payroll_id=$1', [prev.id]);
            await client.query('update public.payroll_adjustments set payroll_id=null where payroll_id=$1', [prev.id]);
            await client.query('delete from public.payroll where id=$1', [prev.id]);
          }

          await client.query(`insert into public.payroll(id,employee_id,amount,paid_at,status,record_json,payroll_run_id,employee_key,period_start,period_end,gross_pay,deductions,net_pay,attendance_days,payable_hours,breakdown_json,snapshot_json)
            values($1,$2,$3,null,'draft',$4::jsonb,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)`, [payrollId, row.employee_id || row.id, calc.netPay, JSON.stringify({ staffKey: row.staff_key, period: selected.key, status: 'draft' }), runId, row.id, selected.start, selected.end, calc.grossPay, calc.totalDeductions, calc.netPay, row.present_days, calc.payableHours, JSON.stringify(calc), JSON.stringify(snapshot)]);
          for (const recoveryItem of recoveryParts) await client.query(`insert into public.payroll_advance_repayments(id,advance_id,payroll_id,period_start,amount,created_by) values($1,$2,$3,$4::date,$5,$6)`, [id(), recoveryItem.advanceId, payrollId, selected.start, recoveryItem.amount, auth.account.id]);
          for (const adjustment of [...rowsExtras.earnings, ...rowsExtras.deductions]) await client.query('update public.payroll_adjustments set payroll_id=$2 where id=$1 and payroll_id is null', [adjustment.id, payrollId]);
          saved += 1;
        }

        const totalsRes = await client.query('select count(*)::int staff_count, coalesce(sum(gross_pay),0)::numeric gross_total, coalesce(sum(deductions),0)::numeric deduction_total, coalesce(sum(net_pay),0)::numeric net_total from public.payroll where payroll_run_id=$1', [runId]);
        const totals = totalsRes.rows[0];
        await client.query('update public.payroll_runs set gross_total=$2,deduction_total=$3,net_total=$4,review_required=false,review_reason=\'\',updated_at=now() where id=$1', [runId, totals.gross_total, totals.deduction_total, totals.net_total]);
        await audit(client, auth.account, existingRun ? 'payroll.recalculated' : 'payroll.generated', { period: selected.key, recalculated: Boolean(existingRun), staffCount: Number(totals.staff_count), grossTotal: Number(totals.gross_total), deductionTotal: Number(totals.deduction_total), netTotal: Number(totals.net_total) }, null, runId);
        await client.query('commit'); invalidate();
        return send(res, 201, { run: { id: runId, period: selected.key, status: existingRun?.status || 'draft', staffCount: Number(totals.staff_count), grossTotal: Number(totals.gross_total), deductionTotal: Number(totals.deduction_total), netTotal: Number(totals.net_total) }, generated: saved, skipped: excludedStaff });
      } catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'generate draft payroll', error); return send(res, 500, { error: 'Draft payroll could not be generated.' }); }
      finally { client.release(); }
    }
    const statusMatch = pathname.match(/^\/api\/admin\/payroll\/runs\/([^/]+)\/status$/);
    if (req.method === 'PATCH' && statusMatch) {
      const data = await input(req, res, auth); if (!data) return;
      const next = clean(data.status, 20); const transitions = { draft: 'approved', approved: 'finalized', finalized: 'settled' };
      const client = await getPool().connect();
      try {
        await client.query('begin');
        const { rows } = await client.query('select * from public.payroll_runs where id=$1 for update', [decodeURIComponent(statusMatch[1])]);
        const run = rows[0]; if (!run) { await client.query('rollback'); return send(res, 404, { error: 'Payroll run not found.' }); }
        if (transitions[run.status] !== next) { await client.query('rollback'); return send(res, 409, { error: `Payroll cannot move from ${run.status} to ${next}.` }); }
        if (run.review_required) { await client.query('rollback'); return send(res, 409, { error: 'This payroll needs review because salary or attendance inputs changed. Recalculate the draft before continuing.' }); }
        if (next === 'settled' && (!dateOk(data.paymentDate) || !clean(data.paymentReference, 120) || !['cash','bank transfer','upi','cheque','online'].includes(clean(data.paymentMethod, 30).toLowerCase()))) { await client.query('rollback'); return send(res, 400, { error: 'Enter a valid payment date, reference and payment method to record settlement.' }); }
        const actor = auth.account.id;
        if (next === 'approved') await client.query('update public.payroll_runs set status=$2,approved_by=$3,approved_at=now(),updated_at=now() where id=$1', [run.id, next, actor]);
        else if (next === 'finalized') await client.query('update public.payroll_runs set status=$2,finalized_by=$3,finalized_at=now(),updated_at=now() where id=$1', [run.id, next, actor]);
        else {
          await client.query('update public.payroll_runs set status=$2,settled_by=$3,settled_at=now(),payment_date=$4::date,payment_reference=$5,payment_method=$6,settled_amount=net_total,updated_at=now() where id=$1', [run.id, next, actor, data.paymentDate, clean(data.paymentReference, 120), clean(data.paymentMethod, 30).toLowerCase()]);
          await client.query(`update public.payroll set status='settled',paid_at=$2::date,record_json=jsonb_set(coalesce(record_json,'{}'::jsonb),'{status}','"settled"'::jsonb,true),updated_at=now() where payroll_run_id=$1`, [run.id, data.paymentDate]);
        }
        if (next !== 'settled') await client.query('update public.payroll set status=$2,record_json=jsonb_set(coalesce(record_json,\'{}\'::jsonb),\'{status}\',to_jsonb($2::text),true),updated_at=now() where payroll_run_id=$1', [run.id, next]);
        await audit(client, auth.account, `payroll.${next}`, { from: run.status, to: next, paymentDate: next === 'settled' ? data.paymentDate : null, paymentMethod: next === 'settled' ? data.paymentMethod : null }, null, run.id, data.reason || '');
        await client.query('commit'); invalidate(); return send(res, 200, { id: run.id, status: next });
      } catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'transition payroll run', error); return send(res, 500, { error: 'Payroll status could not be updated.' }); }
      finally { client.release(); }
    }
    const profileMatch = pathname.match(/^\/api\/admin\/payroll\/profiles\/([^/]+)$/);
    if ((req.method === 'PUT' || req.method === 'POST') && profileMatch) {
      const data = await input(req, res, auth); if (!data) return;
      const model = clean(data.model, 20), effectiveFrom = clean(data.effectiveFrom, 10), reason = clean(data.reason, 1000);
      const allowed = new Set(['monthly','hourly','per_class','per_hour','hybrid']);
      const numbers = ['monthlyRate','hourlyRate','classRate','teachingHourRate','allowance'];
      if (!allowed.has(model) || !dateOk(effectiveFrom) || numbers.some(key => !amountOk(data[key] ?? 0)) || !data.attendancePolicy || typeof data.attendancePolicy !== 'object' || Array.isArray(data.attendancePolicy)) return send(res, 400, { error: 'Check the compensation model, rates, policy and effective date.' });
      const hasMonthly = Number(data.monthlyRate || 0) > 0;
      const hasHourly = Number(data.hourlyRate || data.teachingHourRate || 0) > 0;
      const hasClass = Number(data.classRate || 0) > 0;
      if ((model === 'monthly' && !hasMonthly) || (['hourly','per_hour'].includes(model) && !hasHourly) || (model === 'per_class' && !hasClass) || (model === 'hybrid' && (!hasMonthly || !hasClass))) return send(res, 400, { error: 'Enter a positive rate required by the selected compensation model.' });
      const staffId = decodeURIComponent(profileMatch[1]); const client = await getPool().connect();
      try {
        await client.query('begin');
        const staff = await client.query('select id from public.staff where id=$1 for update', [staffId]);
        if (!staff.rows[0]) { await client.query('rollback'); return send(res, 404, { error: 'Staff member not found.' }); }
        const locked = await client.query(`select 1 from public.payroll p join public.payroll_runs r on r.id=p.payroll_run_id where p.employee_key=$1 and r.status in ('finalized','settled') and r.period_end >= $2::date and r.period_start <= $2::date limit 1`, [staffId, effectiveFrom]);
        if (locked.rowCount) { await client.query('rollback'); return send(res, 409, { error: 'A finalized or settled payroll covers this effective date. Use a later effective date.' }); }
        await client.query(`update public.staff_compensation_history set effective_to=$2::date-1 where staff_id=$1 and effective_to is null and effective_from<$2::date`, [staffId, effectiveFrom]);
        await client.query(`insert into public.staff_compensation_history(id,staff_id,compensation_model,monthly_rate,hourly_rate,class_rate,teaching_hour_rate,allowance,effective_from,attendance_policy,reason,changed_by)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::jsonb,$11,$12)
          on conflict(staff_id,effective_from) do update set compensation_model=excluded.compensation_model,monthly_rate=excluded.monthly_rate,hourly_rate=excluded.hourly_rate,class_rate=excluded.class_rate,teaching_hour_rate=excluded.teaching_hour_rate,allowance=excluded.allowance,attendance_policy=excluded.attendance_policy,reason=excluded.reason,changed_by=excluded.changed_by,created_at=now()`, [id(), staffId, model, data.monthlyRate || 0, data.hourlyRate || 0, data.classRate || 0, data.teachingHourRate || 0, data.allowance || 0, effectiveFrom, JSON.stringify({ deductUnpaidAbsences: data.attendancePolicy.deductUnpaidAbsences === true }), reason, auth.account.id]);
        await audit(client, auth.account, 'compensation.profile_updated', { model, effectiveFrom, monthlyRate: Number(data.monthlyRate || 0), hourlyRate: Number(data.hourlyRate || 0), classRate: Number(data.classRate || 0), teachingHourRate: Number(data.teachingHourRate || 0), allowance: Number(data.allowance || 0) }, staffId, null, reason);
        await markPayrollReview(client, staffId, effectiveFrom, 'Effective compensation profile changed after draft generation.');
        await client.query('commit'); invalidate(); return send(res, 200, { saved: true });
      } catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'save compensation profile', error); return send(res, 500, { error: 'Compensation profile could not be saved.' }); }
      finally { client.release(); }
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/increments') {
      const data = await input(req, res, auth); if (!data) return;
      if (!data.staffId || !dateOk(data.effectiveFrom) || !clean(data.reason, 1000)) return send(res, 400, { error: 'Select staff, an effective date and a reason for this increment.' });
      const current = await getPool().query(`select h.* from public.staff_compensation_history h where h.staff_id=$1 and h.effective_from<=$2::date order by h.effective_from desc limit 1`, [clean(data.staffId, 120), data.effectiveFrom]);
      if (!current.rows[0]) return send(res, 409, { error: 'Save a compensation profile before recording an increment.' });
      const previous = current.rows[0], next = { model: previous.compensation_model, monthlyRate: Number(previous.monthly_rate), hourlyRate: Number(previous.hourly_rate), classRate: Number(previous.class_rate), teachingHourRate: Number(previous.teaching_hour_rate), allowance: Number(previous.allowance), attendancePolicy: previous.attendance_policy };
      const target = clean(data.rateField, 30); if (!['monthlyRate','hourlyRate','classRate','teachingHourRate'].includes(target)) return send(res, 400, { error: 'Choose a valid salary or rate field.' });
      const newValue = data.newRate !== undefined ? Number(data.newRate) : next[target] + Number(data.incrementAmount || 0);
      if (!Number.isFinite(newValue) || newValue < 0 || newValue > 100000000 || (data.newRate === undefined && (!amountOk(data.incrementAmount) || Number(data.incrementAmount) <= 0))) return send(res, 400, { error: 'Enter a valid new rate or increment amount.' });
      next[target] = newValue;
      return saveProfile({ req, res, auth, staffId: data.staffId, data: { ...next, effectiveFrom: data.effectiveFrom, reason: clean(data.reason, 1000) }, endpoint: pathname });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/advances') {
      const data = await input(req, res, auth); if (!data) return;
      if (!clean(data.staffId, 120) || !amountOk(data.amount) || Number(data.amount) <= 0 || !amountOk(data.repaymentAmount ?? 0) || Number(data.repaymentAmount || 0) > Number(data.amount) || !clean(data.reason, 1000)) return send(res, 400, { error: 'Enter a staff member, valid advance and installment amounts, and a reason.' });
      const client = await getPool().connect(); const advanceId = id();
      try {
        await client.query('begin');
        const result = await client.query(`insert into public.payroll_advances(id,staff_id,amount,repayment_amount,reason,requested_date,status,created_by) select $1,id,$3,$4,$5,coalesce(nullif($6,'')::date,current_date),'pending',$7 from public.staff where id=$2 returning id`, [advanceId, clean(data.staffId, 120), data.amount, data.repaymentAmount || 0, clean(data.reason, 1000), dateOk(data.requestedDate) ? data.requestedDate : '', auth.account.id]);
        if (!result.rowCount) { await client.query('rollback'); return send(res, 404, { error: 'Staff member not found.' }); }
        await audit(client, auth.account, 'advance.requested', { advanceId, amount: Number(data.amount), repaymentAmount: Number(data.repaymentAmount || 0) }, clean(data.staffId, 120), null, clean(data.reason, 1000));
        await client.query('commit'); invalidate(); return send(res, 201, { id: advanceId, status: 'pending' });
      } catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'create salary advance', error); return send(res, 500, { error: 'Advance request could not be saved.' }); }
      finally { client.release(); }
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/adjustments') {
      const data = await input(req, res, auth); if (!data) return;
      const adjustmentPeriod = data.period && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.period) ? periodFrom(new URL(`http://local/?month=${Number(data.period.slice(5,7))}&year=${Number(data.period.slice(0,4))}`)) : period;
      if (!clean(data.staffId, 120) || !['earning','deduction'].includes(data.kind) || !clean(data.label, 120) || !amountOk(data.amount) || Number(data.amount) <= 0 || !clean(data.reason, 1000)) return send(res, 400, { error: 'Enter a staff member, adjustment type, label, amount and reason.' });
      const client = await getPool().connect(); const adjustmentId = id();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [adjustmentPeriod.key]);
        const run = await client.query(`select status from public.payroll_runs where period_start=$1::date and period_end=$2::date for update`, [adjustmentPeriod.start, adjustmentPeriod.end]);
        if (run.rows[0]) { await client.query('rollback'); return send(res, 409, { error: 'This period already has a payroll snapshot. Choose an open period for a controlled correction.' }); }
        const result = await client.query(`insert into public.payroll_adjustments(id,staff_id,period_start,period_end,kind,label,amount,reason,status,created_by)
          select $1,id,$3::date,$4::date,$5,$6,$7,$8,'pending',$9 from public.staff where id=$2 returning id`, [adjustmentId, clean(data.staffId, 120), adjustmentPeriod.start, adjustmentPeriod.end, data.kind, clean(data.label, 120), data.amount, clean(data.reason, 1000), auth.account.id]);
        if (!result.rowCount) { await client.query('rollback'); return send(res, 404, { error: 'Staff member not found.' }); }
        await audit(client, auth.account, `payroll_adjustment.${data.kind}_created`, { adjustmentId, label: clean(data.label, 120), amount: Number(data.amount) }, clean(data.staffId, 120), null, clean(data.reason, 1000));
        await client.query('commit'); invalidate(); return send(res, 201, { id: adjustmentId, status: 'pending' });
      } catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'create payroll adjustment', error); return send(res, 500, { error: 'Payroll adjustment could not be saved.' }); }
      finally { client.release(); }
    }
    const adjustmentMatch = pathname.match(/^\/api\/admin\/payroll\/adjustments\/([^/]+)$/);
    if (req.method === 'PATCH' && adjustmentMatch) {
      const data = await input(req, res, auth); if (!data) return;
      if (!['approved','rejected'].includes(data.status)) return send(res, 400, { error: 'Adjustment status must be approved or rejected.' });
      const client = await getPool().connect();
      try { await client.query('begin'); const result = await client.query(`update public.payroll_adjustments set status=$2,approved_by=$3,approved_at=now() where id=$1 and status='pending' and payroll_id is null returning id,staff_id,kind,amount`, [decodeURIComponent(adjustmentMatch[1]), data.status, auth.account.id]); if (!result.rows[0]) { await client.query('rollback'); return send(res, 409, { error: 'This adjustment is no longer pending or is already part of a payroll snapshot.' }); } await audit(client, auth.account, `payroll_adjustment.${data.status}`, { adjustmentId: result.rows[0].id, kind: result.rows[0].kind, amount: Number(result.rows[0].amount) }, result.rows[0].staff_id, null, data.reason || ''); await client.query('commit'); invalidate(); return send(res, 200, { id: result.rows[0].id, status: data.status }); }
      catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'review payroll adjustment', error); return send(res, 500, { error: 'Payroll adjustment could not be reviewed.' }); } finally { client.release(); }
    }
    const advanceMatch = pathname.match(/^\/api\/admin\/payroll\/advances\/([^/]+)$/);
    if (req.method === 'PATCH' && advanceMatch) {
      const data = await input(req, res, auth); if (!data) return;
      if (!['approved','cancelled'].includes(data.status)) return send(res, 400, { error: 'Advance status must be approved or cancelled.' });
      const result = await getPool().query(`update public.payroll_advances set status=$2,approved_by=case when $2='approved' then $3 else approved_by end,approved_at=case when $2='approved' then now() else approved_at end where id=$1 and status='pending' returning id,staff_id`, [decodeURIComponent(advanceMatch[1]), data.status, auth.account.id]);
      if (!result.rows[0]) return send(res, 409, { error: 'This advance is no longer pending.' });
      await getPool().query('insert into public.payroll_audit_events(id,actor_id,staff_id,event_type,reason,details) values($1,$2,$3,$4,$5,$6::jsonb)', [id(), auth.account.id, result.rows[0].staff_id, `advance.${data.status}`, clean(data.reason, 1000), JSON.stringify({ advanceId: result.rows[0].id })]);
      invalidate(); return send(res, 200, { id: result.rows[0].id, status: data.status });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/work-records') {
      const data = await input(req, res, auth); if (!data) return;
      if (!clean(data.staffId, 120) || !dateOk(data.workDate) || !['attendance','teaching','hourly'].includes(data.recordKind) || !['present','absent','late','leave','holiday','completed','cancelled','rescheduled','no_show'].includes(clean(data.workStatus, 24).toLowerCase()) || !Number.isInteger(Number(data.minutes || 0)) || Number(data.minutes || 0) < 0 || Number(data.minutes || 0) > 1440 || !clean(data.reason, 1000)) return send(res, 400, { error: 'Review the staff member, date, record type, status, duration and reason.' });
      const workStatus = clean(data.workStatus, 24).toLowerCase();
      const allowedWorkStatuses = data.recordKind === 'attendance' ? ['present','absent','late','leave','holiday'] : ['completed','cancelled','rescheduled','no_show'];
      if (!allowedWorkStatuses.includes(workStatus)) return send(res, 400, { error: 'Choose a status that matches the attendance or teaching record type.' });
      const workId = id();
      const result = await getPool().query(`insert into public.payroll_work_records(id,staff_id,class_session_id,work_date,record_kind,source,verification_status,status,minutes,payable_minutes,record_json,created_by)
        select $1,id,nullif($3,''),$4::date,'${data.recordKind}','manual','pending','pending',$5,0,$6::jsonb,$7 from public.staff where id=$2 returning id`, [workId, clean(data.staffId, 120), clean(data.classSessionId, 160), data.workDate, Number(data.minutes || 0), JSON.stringify({ attendanceStatus: workStatus, payUnit: clean(data.payUnit, 20).toLowerCase(), reason: clean(data.reason, 1000) }), auth.account.id]);
      if (!result.rowCount) return send(res, 404, { error: 'Staff member not found.' });
      await markPayrollReview(getPool(), clean(data.staffId, 120), data.workDate, 'New staff attendance or teaching record added after draft generation.');
      invalidate(); return send(res, 201, { id: workId, status: 'pending', verificationStatus: 'pending' });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/zoom/mappings') {
      const data = await input(req, res, auth); if (!data) return;
      if (!clean(data.staffId, 120) || !clean(data.meetingId, 160) || !dateOk(data.workDate) || !Number.isInteger(Number(data.durationMinutes)) || Number(data.durationMinutes) < 1 || Number(data.durationMinutes) > 720) return send(res, 400, { error: 'Provide a staff member, meeting ID, date and expected duration.' });
      const workId = id();
      const result = await getPool().query(`insert into public.payroll_work_records(id,staff_id,class_session_id,work_date,record_kind,source,verification_status,status,minutes,payable_minutes,provider_meeting_id,scheduled_start,scheduled_end,record_json,created_by)
        select $1,id,$3,$4::date,'teaching','zoom','pending','pending',$5,0,$6,$7::timestamptz,$8::timestamptz,$9::jsonb,$10 from public.staff where id=$2 returning id`,
      [workId, clean(data.staffId, 120), clean(data.classSessionId, 160), data.workDate, Number(data.durationMinutes) * 60, clean(data.meetingId, 160), data.scheduledStart || null, data.scheduledEnd || null, JSON.stringify({ isMapping: true, payUnit: clean(data.payUnit || 'hour', 20), topic: clean(data.topic, 180) }), auth.account.id]);
      if (!result.rowCount) return send(res, 404, { error: 'Staff member not found.' });
      invalidate(); return send(res, 201, { id: workId, status: 'mapping_pending' });
    }
    const zoomSyncMatch = pathname.match(/^\/api\/admin\/payroll\/zoom\/mappings\/([^/]+)\/sync$/);
    if (req.method === 'POST' && zoomSyncMatch) {
      const data = await input(req, res, auth); if (!data) return;
      const mappingId = decodeURIComponent(zoomSyncMatch[1]);
      const { rows } = await getPool().query(`select id,provider_meeting_id,staff_id from public.payroll_work_records where id=$1 and source='zoom' and record_json->>'isMapping'='true'`, [mappingId]);
      if (!rows[0]) return send(res, 404, { error: 'Zoom meeting mapping was not found.' });
      try { const result = await syncZoomParticipants(rows[0].provider_meeting_id, rows[0].provider_meeting_id, rows[0].staff_id); invalidate(); return send(res, 200, { ...result, verificationStatus: result.matched ? 'verified' : 'pending' }); }
      catch (error) { log(pathname, 'manual Zoom report sync', error); return send(res, 502, { error: 'Zoom attendance report is not available yet. Retry after the report is ready.' }); }
    }
    const workMatch = pathname.match(/^\/api\/admin\/payroll\/work-records\/([^/]+)\/approve$/);
    if (req.method === 'POST' && workMatch) {
      const data = await input(req, res, auth); if (!data) return;
      const client = await getPool().connect();
      try { await client.query('begin'); const result = await client.query(`update public.payroll_work_records set status='approved',verification_status='verified',payable_minutes=case when record_kind='attendance' or lower(coalesce(record_json->>'attendanceStatus','completed')) in ('cancelled','rescheduled','no_show','absent','leave') then 0 else minutes end,approved_by=$2,approved_at=now() where id=$1 and status='pending' returning id,staff_id,work_date`, [decodeURIComponent(workMatch[1]), auth.account.id]); if (!result.rows[0]) { await client.query('rollback'); return send(res, 409, { error: 'This work record is no longer pending.' }); } await audit(client, auth.account, 'work_record.approved', { workRecordId: result.rows[0].id }, result.rows[0].staff_id, null, data.reason || ''); await markPayrollReview(client, result.rows[0].staff_id, result.rows[0].work_date, 'Approved staff attendance or teaching record changed after draft generation.'); await client.query('commit'); invalidate(); return send(res, 200, { id: result.rows[0].id, status: 'approved' }); }
      catch (error) { try { await client.query('rollback'); } catch {} log(pathname, 'approve work record', error); return send(res, 500, { error: 'Work record could not be approved.' }); } finally { client.release(); }
    }
    if (req.method === 'GET' && /^\/api\/admin\/payroll\/staff\/[^/]+$/.test(pathname)) {
      const staffId = decodeURIComponent(pathname.split('/').at(-1));
      const results = await Promise.all([
        queryWithLimit(() => getPool().query(`select p.id,p.period_start,p.period_end,p.status,p.gross_pay,p.deductions,p.net_pay,p.attendance_days,p.payable_hours,p.breakdown_json,p.snapshot_json,p.paid_at,p.record_json from public.payroll p where p.employee_key=$1 order by p.period_start desc nulls last,p.created_at desc limit 60`, [staffId])),
        queryWithLimit(() => getPool().query(`select id,work_date,record_kind,source,verification_status,status,minutes,payable_minutes,record_json from public.payroll_work_records where staff_id=$1 order by work_date desc,id desc limit 100`, [staffId])),
        queryWithLimit(() => getPool().query(`select id,compensation_model,monthly_rate,hourly_rate,class_rate,teaching_hour_rate,allowance,effective_from,effective_to,attendance_policy,reason from public.staff_compensation_history where staff_id=$1 order by effective_from desc limit 50`, [staffId])),
        queryWithLimit(() => getPool().query(`select id,period_start,period_end,kind,label,amount,reason,status,approved_at from public.payroll_adjustments where staff_id=$1 order by period_start desc,created_at desc limit 100`, [staffId])),
      ]);
      const staff = await getPool().query('select id,staff_key,employee_id,name,email,role,staff_type,employment_type from public.staff where id=$1', [staffId]);
      if (!staff.rows[0]) return send(res, 404, { error: 'Staff member not found.' });
      const payrollHistory = results[0].rows.map(row => ({ id: row.id, periodStart: row.period_start ? String(row.period_start).slice(0, 10) : null, periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : null, status: row.status, grossPay: Number(row.gross_pay ?? row.amount ?? 0), deductions: Number(row.deductions || 0), netPay: Number(row.net_pay ?? row.amount ?? 0), attendanceDays: Number(row.attendance_days || 0), payableHours: Number(row.payable_hours || 0), breakdown: row.breakdown_json || {}, snapshot: row.snapshot_json || {}, paymentDate: row.paid_at || row.record_json?.paidAt || null }));
      return send(res, 200, { staff: staff.rows[0], payrollHistory, workRecords: results[1].rows.map(row => ({ id: row.id, date: String(row.work_date).slice(0, 10), kind: row.record_kind, source: row.source, verificationStatus: row.verification_status, status: row.status, minutes: row.minutes, payableMinutes: row.payable_minutes, record_json: row.record_json || {}, ...row.record_json })), compensationHistory: results[2].rows.map(row => ({ id: row.id, model: row.compensation_model, monthlyRate: Number(row.monthly_rate), hourlyRate: Number(row.hourly_rate), classRate: Number(row.class_rate), teachingHourRate: Number(row.teaching_hour_rate), allowance: Number(row.allowance), effectiveFrom: String(row.effective_from).slice(0, 10), effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null, attendancePolicy: row.attendance_policy, reason: row.reason })), adjustments: results[3].rows.map(row => ({ id: row.id, periodStart: String(row.period_start).slice(0,10), periodEnd: String(row.period_end).slice(0,10), kind: row.kind, label: row.label, amount: Number(row.amount), reason: row.reason, status: row.status, approvedAt: row.approved_at })) });
    }
    if (req.method === 'POST' && pathname === '/api/admin/payroll/staff-payment-details') {
      const data = await input(req, res, auth); if (!data) return;
      const staffId = clean(data.staffId, 120);
      if (!staffId) return send(res, 400, { error: 'Staff ID is required.' });
      const paymentMode = clean(data.paymentMode, 20) || 'both';
      const accountHolderName = clean(data.accountHolderName, 120);
      const bankName = clean(data.bankName, 120);
      const bankAccountNumber = clean(data.bankAccountNumber, 34).replace(/\s/g, '');
      const ifscCode = clean(data.ifscCode, 11).toUpperCase().trim();
      const branch = clean(data.branch, 120);
      const upiId = clean(data.upiId, 120).trim();

      if (!bankAccountNumber && !upiId) {
        return send(res, 400, { error: 'Please provide either Bank Account or UPI details for payroll payouts.' });
      }
      if (bankAccountNumber) {
        if (!/^[0-9]{6,34}$/.test(bankAccountNumber)) return send(res, 400, { error: 'Enter a valid bank account number (6 to 34 digits).' });
        if (ifscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) return send(res, 400, { error: 'Enter a valid 11-character IFSC code (e.g. HDFC0001234).' });
      }
      if (upiId) {
        if (!/^[\w.\-_]{2,}@[a-zA-Z0-9.\-_]{2,}$/.test(upiId)) return send(res, 400, { error: 'Enter a valid UPI ID (e.g. name@okhdfcbank or 9876543210@paytm).' });
      }

      const client = await getPool().connect();
      try {
        await client.query('begin');
        const found = await client.query('select id, name, record_json from public.staff where id=$1', [staffId]);
        if (!found.rowCount) { await client.query('rollback'); return send(res, 404, { error: 'Staff member not found.' }); }
        const staff = found.rows[0];
        const holderName = accountHolderName || staff.name || '';
        await client.query(`insert into public.staff_private(staff_id,account_holder_name,bank_name,bank_account_number,ifsc_code,branch,upi_id,payment_mode,updated_at)
          values($1,nullif($2,''),nullif($3,''),nullif($4,''),nullif($5,''),nullif($6,''),nullif($7,''),$8,now())
          on conflict(staff_id) do update set
            account_holder_name=excluded.account_holder_name,
            bank_name=excluded.bank_name,
            bank_account_number=excluded.bank_account_number,
            ifsc_code=excluded.ifsc_code,
            branch=excluded.branch,
            upi_id=excluded.upi_id,
            payment_mode=excluded.payment_mode,
            updated_at=now()`,
          [staffId, holderName, bankName, bankAccountNumber, ifscCode, branch, upiId, paymentMode]);

        const paymentDetails = { paymentMode, accountHolderName: holderName, bankName, bankAccountNumber, ifscCode, branch, upiId };
        const updatedRecord = { ...(staff.record_json || {}), paymentDetails };
        await client.query('update public.staff set record_json=$2::jsonb,updated_at=now() where id=$1', [staffId, JSON.stringify(updatedRecord)]);
        await client.query('commit');
        invalidate();
        return send(res, 200, { ok: true, staffId, paymentDetails, hasPaymentDetails: true });
      } catch (err) {
        try { await client.query('rollback'); } catch {}
        log(pathname, 'save payment details', err);
        return send(res, 500, { error: 'Payment details could not be saved.' });
      } finally {
        client.release();
      }
    }
    if (req.method === 'GET' && pathname === '/api/admin/payroll/zoom/status') {
      const { rows } = await queryWithLimit(() => getPool().query(`select connected,updated_at from public.integration_connections where provider='zoom' limit 1`));
      return send(res, 200, { credentialsSaved: Boolean(rows[0]?.connected), webhookSecretConfigured: Boolean(process.env.ZOOM_WEBHOOK_SECRET_TOKEN), endpoint: '/api/webhooks/zoom', participantSync: Boolean(rows[0]?.connected), message: process.env.ZOOM_WEBHOOK_SECRET_TOKEN ? 'Zoom webhook signature validation is ready.' : 'Set ZOOM_WEBHOOK_SECRET_TOKEN in the server environment to enable signed Zoom webhook events.' });
    }
    log(pathname, `unmatched route method=${req.method}`, { code: 'ROUTE_NOT_FOUND', message: 'No payroll handler matched this request path and method.' });
    return send(res, 404, { error: 'Payroll route not found.' });
  } catch (error) {
    log(pathname, 'request handler', error);
    if (isRequiredPayrollTableMissing(error)) return send(res, 200, { ...emptyDashboard(period, true), error: 'Payroll schema is pending. Apply the server migrations.' });
    if (String(error?.code || '') === '23505') return send(res, 409, { error: 'A matching attendance or class-session record already exists.' });
    return send(res, 500, { error: 'This payroll request could not be completed. Please retry.' });
  }
}

async function saveProfile({ req, res, auth, staffId, data, endpoint }) {
  const model = clean(data.model, 20), effectiveFrom = clean(data.effectiveFrom, 10), reason = clean(data.reason, 1000);
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const staff = await client.query('select id from public.staff where id=$1 for update', [clean(staffId, 120)]);
    if (!staff.rows[0]) { await client.query('rollback'); return send(res, 404, { error: 'Staff member not found.' }); }
    await client.query(`update public.staff_compensation_history set effective_to=$2::date-1 where staff_id=$1 and effective_to is null and effective_from<$2::date`, [staffId, effectiveFrom]);
    await client.query(`insert into public.staff_compensation_history(id,staff_id,compensation_model,monthly_rate,hourly_rate,class_rate,teaching_hour_rate,allowance,effective_from,attendance_policy,reason,changed_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9::date,$10::jsonb,$11,$12)
      on conflict(staff_id,effective_from) do update set compensation_model=excluded.compensation_model,monthly_rate=excluded.monthly_rate,hourly_rate=excluded.hourly_rate,class_rate=excluded.class_rate,teaching_hour_rate=excluded.teaching_hour_rate,allowance=excluded.allowance,attendance_policy=excluded.attendance_policy,reason=excluded.reason,changed_by=excluded.changed_by,created_at=now()`, [id(), clean(staffId, 120), model, data.monthlyRate || 0, data.hourlyRate || 0, data.classRate || 0, data.teachingHourRate || 0, data.allowance || 0, effectiveFrom, JSON.stringify({ deductUnpaidAbsences: data.attendancePolicy?.deductUnpaidAbsences === true }), reason, auth.account.id]);
    await audit(client, auth.account, 'compensation.increment', { model, effectiveFrom, rates: { monthlyRate: Number(data.monthlyRate || 0), hourlyRate: Number(data.hourlyRate || 0), classRate: Number(data.classRate || 0), teachingHourRate: Number(data.teachingHourRate || 0), allowance: Number(data.allowance || 0) } }, clean(staffId, 120), null, reason);
    await markPayrollReview(client, clean(staffId, 120), effectiveFrom, 'Salary increment changed after draft generation.');
    await client.query('commit'); invalidate(); return send(res, 200, { saved: true });
  } catch (error) { try { await client.query('rollback'); } catch {} log(endpoint, 'save effective compensation', error); return send(res, 500, { error: 'Compensation change could not be saved.' }); }
  finally { client.release(); }
}

async function readRaw(req, limit = 1024 * 1024) {
  const parts = []; let size = 0;
  for await (const part of req) { size += part.length; if (size > limit) throw new Error('Webhook body too large.'); parts.push(part); }
  return Buffer.concat(parts).toString('utf8');
}
function zoomCredentials(encrypted) {
  const key = Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw Object.assign(new Error('Credential encryption key is unavailable.'), { code: 'INTEGRATIONS_KEY_INVALID' });
  const match = /^v1\.([^.]+)\.([^.]+)\.([^.]+)$/.exec(String(encrypted || ''));
  if (!match) throw new Error('Stored integration credential format is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(match[1], 'base64url'));
  decipher.setAuthTag(Buffer.from(match[2], 'base64url'));
  const clear = Buffer.concat([decipher.update(Buffer.from(match[3], 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(clear);
}
async function zoomAccessToken() {
  const { rows } = await getPool().query(`select credentials_encrypted from public.integration_connections where provider='zoom' and connected=true limit 1`);
  const credentials = zoomCredentials(rows[0]?.credentials_encrypted);
  const accountId = credentials.account_id || credentials.accountId;
  const clientId = credentials.client_id || credentials.clientId;
  const clientSecret = credentials.client_secret || credentials.clientSecret;
  if (!accountId || !clientId || !clientSecret) throw new Error('Zoom Server-to-Server OAuth credentials are incomplete.');
  const response = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '' });
  if (!response.ok) throw new Error(`Zoom token endpoint returned HTTP ${response.status}.`);
  const result = await response.json(); if (!result.access_token) throw new Error('Zoom token response did not contain an access token.'); return result.access_token;
}
async function syncZoomParticipants(meetingId, uuid, expectedStaffId) {
  const token = await zoomAccessToken();
  const encoded = encodeURIComponent(uuid || meetingId);
  const response = await fetch(`https://api.zoom.us/v2/report/meetings/${encoded}/participants?page_size=300`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Zoom participant report returned HTTP ${response.status}.`);
  const data = await response.json();
  const participants = Array.isArray(data.participants) ? data.participants : [];
  const emails = [...new Set(participants.map(p => String(p.user_email || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return { matched: 0, pending: true };
  const { rows: staff } = await getPool().query('select id,email from public.staff where id=$1 and lower(email)=any($2::text[])', [expectedStaffId, emails]);
  if (staff.length !== 1) return { matched: 0, pending: staff.length === 0, ambiguous: staff.length > 1 };
  const teacher = staff[0];
  const matching = participants.filter(row => String(row.user_email || '').trim().toLowerCase() === teacher.email.toLowerCase());
  const totalMinutes = matching.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.duration || 0) / 60)), 0);
  await getPool().query(`update public.payroll_work_records set minutes=$3,payable_minutes=0,verification_status='verified',record_json=record_json||$4::jsonb where provider_meeting_id=$1 and staff_id=$2 and source='zoom'`, [meetingId, teacher.id, totalMinutes, JSON.stringify({ participantCount: matching.length, syncStatus: 'verified' })]);
  return { matched: 1, participantCount: matching.length, minutes: totalMinutes };
}
async function handleZoomWebhook(req, res) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!secret) return send(res, 503, { error: 'Zoom webhook verification is not configured.' });
  let raw;
  try { raw = await readRaw(req); } catch (error) { return send(res, 413, { error: 'Webhook request is too large.' }); }
  const timestamp = String(req.headers['x-zm-request-timestamp'] || '');
  const signature = String(req.headers['x-zm-signature'] || '');
  if (!/^\d{10,}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return send(res, 401, { error: 'Zoom webhook timestamp is invalid or expired.' });
  const expected = `v0=${crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${raw}`).digest('hex')}`;
  if (!safeEqual(signature, expected)) return send(res, 401, { error: 'Zoom webhook signature is invalid.' });
  let event;
  try { event = JSON.parse(raw); } catch { return send(res, 400, { error: 'Zoom webhook JSON is invalid.' }); }
  if (event.event === 'endpoint.url_validation' && event.payload?.plainToken) {
    const encryptedToken = crypto.createHmac('sha256', secret).update(event.payload.plainToken).digest('hex');
    return send(res, 200, { plainToken: event.payload.plainToken, encryptedToken });
  }
  const meeting = event.payload?.object || {};
  const meetingId = String(meeting.id || ''); const meetingUuid = String(meeting.uuid || '');
  if (!meetingId || !['meeting.started','meeting.ended','meeting.participant_joined','meeting.participant_left'].includes(event.event)) return send(res, 200, { accepted: true, ignored: true });
  const eventId = String(req.headers['x-zm-request-id'] || event.event_ts || `${event.event}:${meetingUuid}:${meeting.start_time || ''}`);
  try {
    const { rows } = await getPool().query(`select staff_id,class_session_id from public.payroll_work_records where provider_meeting_id=any($1::text[]) and source='zoom' and record_json->>'isMapping'='true' order by created_at desc limit 2`, [[meetingId, meetingUuid]]);
    if (rows.length !== 1) return send(res, 202, { accepted: true, pendingMapping: rows.length === 0, ambiguous: rows.length > 1 });
    const startAt = meeting.start_time ? new Date(meeting.start_time) : null, endAt = meeting.end_time ? new Date(meeting.end_time) : null;
    const inserted = await getPool().query(`insert into public.payroll_zoom_events(id,provider_event_id,meeting_id,meeting_uuid,event_type,event_json) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(provider_event_id) do nothing returning id`, [id(), eventId, meetingId, meetingUuid, event.event, JSON.stringify({ event: event.event, startTime: meeting.start_time || null, endTime: meeting.end_time || null })]);
    if (!inserted.rowCount) return send(res, 200, { accepted: true, duplicate: true });
    if (startAt || endAt) await getPool().query(`update public.payroll_work_records set joined_at=coalesce(joined_at,$2::timestamptz),left_at=coalesce($3::timestamptz,left_at),record_json=record_json||$4::jsonb where provider_meeting_id=any($1::text[]) and source='zoom' and record_json->>'isMapping'='true'`, [[meetingId, meetingUuid], startAt?.toISOString() || null, endAt?.toISOString() || null, JSON.stringify({ lastZoomEvent: event.event })]);
    if (event.event === 'meeting.ended') {
      try { const sync = await syncZoomParticipants(meetingId, meetingUuid, rows[0].staff_id); await getPool().query(`update public.payroll_zoom_events set processing_status=$2,processed_at=now() where provider_event_id=$1`, [eventId, sync.matched ? 'processed' : sync.ambiguous ? 'ambiguous' : 'report_pending']); if (sync.pending) log('/api/webhooks/zoom', 'participant report pending or identity unresolved', Object.assign(new Error(sync.ambiguous ? 'More than one staff email matched the report.' : 'Participant report is not available or no staff email matched.'), { code: 'ZOOM_REPORT_PENDING' })); }
      catch (error) { log('/api/webhooks/zoom', 'sync participant report', error); }
    }
    invalidate(); return send(res, 202, { accepted: true });
  } catch (error) { log('/api/webhooks/zoom', 'persist verified event', error); return send(res, 500, { error: 'Zoom event could not be processed.' }); }
}

module.exports = { handlePayrollRoute, calculatePayroll, workingDays, createPayslipPdf, createZipArchive };
