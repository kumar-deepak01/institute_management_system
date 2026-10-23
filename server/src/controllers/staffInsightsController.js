'use strict';

const crypto = require('node:crypto');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');

const send = (res, status, value) => json(res, status, value);
const clean = (value, max = 240) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const cache = new Map();
const CACHE_MS = 12000;

function safeLog(endpoint, step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error')
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key|credentials)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  console.error(`[staff-insights] endpoint=${endpoint} step=${step} code=${code} message=${message}`);
}
function getCached(key) {
  const item = cache.get(key);
  if (item && item.expires > Date.now()) return item.value;
  cache.delete(key);
  return null;
}
function setCached(key, value) { cache.set(key, { value, expires: Date.now() + CACHE_MS }); }
function invalidate() { cache.clear(); }
async function authenticate(req) {
  const session = getSession(req);
  if (!session) return { error: { status: 401, message: 'Sign in required.' } };
  const account = await resolveSessionAccount(req);
  if (!account) return { error: { status: 401, message: 'Sign in required.' } };
  if (account.role !== 'admin') return { error: { status: 403, message: 'Administrator access is required.' } };
  return { session, account };
}
async function readInput(req, res, session) {
  if (!validCsrfRequest(req, session)) { send(res, 403, { error: 'CSRF validation failed.' }); return null; }
  try { return await body(req, 256 * 1024); }
  catch { send(res, 400, { error: 'Invalid request body.' }); return null; }
}
function validClock(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')); }
function validPositive(value, max = 1440) { return Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max; }

async function handleWorkShifts(req, res, url, auth) {
  const endpoint = url.pathname;
  if (req.method === 'GET' && endpoint === '/api/admin/work-shifts') {
    const cached = getCached('work-shifts');
    if (cached) return send(res, 200, cached);
    try {
      const [templates, assignments, staff] = await Promise.all([
        queryWithLimit(() => getPool().query("select record_id,record_json from public.app_records where source_tab='Work Shift Templates' order by created_at desc")),
        queryWithLimit(() => getPool().query("select record_id,record_json from public.app_records where source_tab='Work Shift Assignments'")),
        queryWithLimit(() => getPool().query("select id,staff_key,name,email,role,staff_type,employment_type from public.staff where lower(coalesce(status,'active')) not in ('inactive','left','terminated') order by lower(name),id")),
      ]);
      const response = {
        templates: templates.rows.map(row => ({ ...row.record_json, id: row.record_id })),
        assignments: assignments.rows.map(row => ({ ...row.record_json, staffKey: row.record_id })),
        staff: staff.rows.map(row => ({ id: row.id, staffKey: String(row.staff_key), name: row.name, email: row.email, role: row.role, staffType: row.staff_type, employmentType: row.employment_type })),
      };
      setCached('work-shifts', response);
      return send(res, 200, response);
    } catch (error) {
      safeLog(endpoint, 'load templates, assignments and staff', error);
      return send(res, 500, { error: 'Work shifts could not be loaded.' });
    }
  }
  if (req.method === 'POST' && endpoint === '/api/admin/work-shifts/templates') {
    const input = await readInput(req, res, auth.session); if (!input) return;
    const name = clean(input.name, 100), code = clean(input.code, 30).toUpperCase();
    const workStart = clean(input.workStart, 5), workEnd = clean(input.workEnd, 5);
    const lateAfterMinutes = Number(input.lateAfterMinutes), halfDayAfterMinutes = Number(input.halfDayAfterMinutes);
    const halfDayMinHours = Number(input.halfDayMinHours), fullDayMinHours = Number(input.fullDayMinHours);
    if (!name || !validClock(workStart) || !validClock(workEnd) || workStart >= workEnd ||
      !validPositive(lateAfterMinutes) || !validPositive(halfDayAfterMinutes) || !validPositive(halfDayMinHours, 24) ||
      !validPositive(fullDayMinHours, 24) || fullDayMinHours < halfDayMinHours) {
      return send(res, 400, { error: 'Enter a name, valid work times and valid attendance thresholds.' });
    }
    const record = { id: crypto.randomUUID(), name, code, workStart, workEnd, lateAfterMinutes, halfDayAfterMinutes, halfDayMinHours, fullDayMinHours, createdAt: new Date().toISOString() };
    try {
      await queryWithLimit(() => getPool().query("insert into public.app_records(source_tab,record_id,record_json) values('Work Shift Templates',$1,$2::jsonb)", [record.id, JSON.stringify(record)]));
      invalidate();
      return send(res, 201, { template: record });
    } catch (error) { safeLog(endpoint, 'create shift template', error); return send(res, 500, { error: 'The shift template could not be saved.' }); }
  }
  if (req.method === 'PUT' && endpoint === '/api/admin/work-shifts/assignments') {
    const input = await readInput(req, res, auth.session); if (!input) return;
    const shiftId = clean(input.shiftId, 120);
    const staffKeys = Array.isArray(input.staffKeys) ? [...new Set(input.staffKeys.map(key => clean(key, 80)).filter(Boolean))].slice(0, 500) : [];
    if (!shiftId || !staffKeys.length) return send(res, 400, { error: 'Choose a shift and at least one staff member.' });
    try {
      const shift = await queryWithLimit(() => getPool().query("select record_json from public.app_records where source_tab='Work Shift Templates' and record_id=$1", [shiftId]));
      if (!shift.rows[0]) return send(res, 404, { error: 'That shift template no longer exists.' });
      const result = await queryWithLimit(() => getPool().query(`insert into public.app_records(source_tab,record_id,record_json)
        select 'Work Shift Assignments',s.staff_key::text,jsonb_build_object('staffKey',s.staff_key::text,'staffId',s.id,'shiftId',$2,'assignedAt',now())
        from public.staff s where s.staff_key::text=any($1::text[]) and lower(coalesce(s.status,'active')) not in ('inactive','left','terminated')
        on conflict(source_tab,record_id) do update set record_json=excluded.record_json,updated_at=now() returning record_id`, [staffKeys, shiftId]));
      invalidate();
      return send(res, 200, { assigned: result.rowCount });
    } catch (error) { safeLog(endpoint, 'bulk assign shift', error); return send(res, 500, { error: 'Staff shift assignments could not be saved.' }); }
  }
  if (req.method === 'DELETE' && endpoint.startsWith('/api/admin/work-shifts/templates/')) {
    const templateId = clean(decodeURIComponent(endpoint.split('/').pop() || ''), 120);
    try {
      await queryWithLimit(() => getPool().query("delete from public.app_records where source_tab='Work Shift Templates' and record_id=$1", [templateId]));
      await queryWithLimit(() => getPool().query("delete from public.app_records where source_tab='Work Shift Assignments' and record_json->>'shiftId'=$1", [templateId]));
      invalidate();
      return send(res, 200, { ok: true });
    } catch (error) { safeLog(endpoint, 'delete shift template', error); return send(res, 500, { error: 'The shift template could not be deleted.' }); }
  }
  return null;
}

function monthRange(url) {
  const now = new Date();
  const month = Number(url.searchParams.get('month')) || now.getMonth() + 1;
  const year = Number(url.searchParams.get('year')) || now.getFullYear();
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) return null;
  return { month, year, start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` };
}
async function handleFacultyPerformance(req, res, url) {
  if (req.method !== 'GET' || url.pathname !== '/api/admin/faculty-performance') return null;
  const period = monthRange(url);
  if (!period) return send(res, 400, { error: 'Choose a valid month and year.' });
  const batchFilter = clean(url.searchParams.get('batchId'), 120);
  const cacheKey = `faculty:${period.year}-${period.month}:${batchFilter}`;
  const cached = getCached(cacheKey); if (cached) return send(res, 200, cached);
  try {
    const staffResult = await queryWithLimit(() => getPool().query(`select s.id,s.staff_key,s.name,s.email,s.role,s.staff_type,
      coalesce(array_agg(distinct a.batch_id) filter(where a.batch_id is not null),'{}') batch_ids
      from public.staff s left join public.staff_subject_assignments a on a.staff_id=s.id
      where lower(coalesce(s.status,'active')) not in ('inactive','left','terminated')
        and lower(coalesce(s.staff_type,s.role,'')) in ('teacher','faculty','instructor')
        and ($1='' or exists(select 1 from public.staff_subject_assignments af where af.staff_id=s.id and af.batch_id=$1))
      group by s.id,s.staff_key,s.name,s.email,s.role,s.staff_type order by lower(s.name),s.id`, [batchFilter]));
    const people = staffResult.rows;
    const staffIds = people.map(row => row.id);
    const staffKeys = people.map(row => String(row.staff_key));
    const batchIds = [...new Set(people.flatMap(row => row.batch_ids || []).filter(Boolean))];
    const [classesResult, homeworkResult, doubtResult, scoreResult, batchesResult] = await Promise.all([
      queryWithLimit(() => getPool().query(`select wr.staff_id,count(*)::int classes from public.payroll_work_records wr
        where wr.staff_id=any($1::text[]) and wr.record_kind='teaching' and wr.status='approved' and wr.work_date between $2::date and $3::date
          and ($4='' or coalesce(wr.record_json->>'batchId',(select tr.record_json->>'batchId' from public.app_records tr where tr.source_tab='Timetable' and tr.record_id=wr.class_session_id),'')=$4)
        group by wr.staff_id`, [staffIds, period.start, period.end, batchFilter])
        .catch(error => { safeLog(url.pathname, 'count approved teaching records', error); return { rows: [] }; })),
      queryWithLimit(() => getPool().query(`select a.batch_id,count(distinct a.id)::int assigned,
        count(distinct sub.id) filter(where lower(coalesce(sub.status,'')) in ('submitted','graded','complete','completed'))::int completed
        ,(count(distinct a.id)*count(distinct st.id))::int expected
        from public.assignments a left join public.assignment_submissions sub on sub.assignment_id=a.id
        left join public.students st on st.batch_id=a.batch_id and lower(coalesce(st.status,'active')) not in ('dropped','inactive','archived')
        where a.batch_id=any($1::text[]) and coalesce(a.created_at::date,a.due_date,current_date) between $2::date and $3::date group by a.batch_id`, [batchIds, period.start, period.end])
        .catch(error => { safeLog(url.pathname, 'aggregate homework and completion', error); return { rows: [] }; })),
      queryWithLimit(() => getPool().query(`select record_json->>'staffKey' staff_key,count(*)::int answered from public.app_records
        where source_tab='Doubts' and record_json->>'staffKey'=any($1::text[])
          and lower(coalesce(record_json->>'status','open')) in ('answered','resolved','closed') and created_at::date between $2::date and $3::date group by record_json->>'staffKey'`, [staffKeys, period.start, period.end])
        .catch(error => { safeLog(url.pathname, 'count answered doubts', error); return { rows: [] }; })),
      queryWithLimit(() => getPool().query(`select record_json->>'batchId' batch_id,
        avg(case
          when coalesce(record_json->>'percentage','') ~ '^([0-9]{1,3})(\\.[0-9]+)?$' then least(100,greatest(0,(record_json->>'percentage')::numeric))
          when coalesce(record_json->>'obtainedMarks',record_json->>'marksObtained',record_json->>'score','') ~ '^[0-9]+(\\.[0-9]+)?$'
            and coalesce(record_json->>'totalMarks',record_json->>'maxMarks','') ~ '^[0-9]+(\\.[0-9]+)?$'
            and coalesce(nullif(record_json->>'totalMarks',''),nullif(record_json->>'maxMarks',''))::numeric>0
          then least(100,greatest(0,coalesce(nullif(record_json->>'obtainedMarks',''),nullif(record_json->>'marksObtained',''),nullif(record_json->>'score',''))::numeric /
            coalesce(nullif(record_json->>'totalMarks',''),nullif(record_json->>'maxMarks',''))::numeric*100)) end) average_score
        from public.app_records where source_tab=any($1::text[]) and record_json->>'batchId'=any($2::text[])
          and created_at::date between $3::date and $4::date group by record_json->>'batchId'`, [['Exam Results','Online Exam Results','Offline Exam Results','Exam Attempts','Test Results'], batchIds, period.start, period.end])
        .catch(error => { safeLog(url.pathname, 'average exam result scores', error); return { rows: [] }; })),
      queryWithLimit(() => getPool().query('select id,name from public.batches where id=any($1::text[]) order by lower(name)', [batchIds])
        .catch(error => { safeLog(url.pathname, 'load batch filter options', error); return { rows: [] }; })),
    ]);
    const classes = new Map(classesResult.rows.map(row => [row.staff_id, Number(row.classes) || 0]));
    const homeworkByBatch = new Map(homeworkResult.rows.map(row => [row.batch_id, row]));
    const doubts = new Map(doubtResult.rows.map(row => [row.staff_key, Number(row.answered) || 0]));
    const scores = new Map(scoreResult.rows.map(row => [row.batch_id, Number(row.average_score) || 0]));
    const records = people.map(person => {
      const personBatches = batchFilter ? [batchFilter] : person.batch_ids || [];
      const hw = personBatches.reduce((sum, id) => {
        const item = homeworkByBatch.get(id);
      return { assigned: sum.assigned + Number(item?.assigned || 0), completed: sum.completed + Number(item?.completed || 0), expected: sum.expected + Number(item?.expected || 0) };
      }, { assigned: 0, completed: 0, expected: 0 });
      const avgScore = personBatches.length ? personBatches.reduce((sum, id) => sum + (scores.get(id) || 0), 0) / personBatches.length : 0;
      const conducted = classes.get(person.id) || 0;
      const answered = doubts.get(String(person.staff_key)) || 0;
      const score = Math.min(100, avgScore * 0.4 + Math.min(conducted * 5, 30) + Math.min(answered * 2, 30));
      return { staffKey: String(person.staff_key), name: person.name, email: person.email, staffType: person.staff_type || person.role,
        averageStudentScore: Math.round(avgScore * 10) / 10, classesConducted: conducted, homeworkAssigned: hw.assigned,
        homeworkCompletion: hw.expected ? Math.min(100, Math.round(hw.completed / hw.expected * 100)) : 0, doubtsAnswered: answered,
        performanceScore: Math.round(score), batchIds: personBatches };
    });
    const result = { period: { month: period.month, year: period.year }, batches: batchesResult.rows,
      records, summary: { faculty: records.length, averageScore: records.length ? Math.round(records.reduce((n, row) => n + row.performanceScore, 0) / records.length) : 0 } };
    setCached(cacheKey, result);
    return send(res, 200, result);
  } catch (error) {
    safeLog(url.pathname, 'assemble faculty performance', error);
    return send(res, 500, { error: 'Faculty performance could not be loaded.' });
  }
}

async function handleStaffInsightsRoute(req, res, url) {
  const isWorkShift = url.pathname === '/api/admin/work-shifts' || url.pathname.startsWith('/api/admin/work-shifts/');
  const isPerformance = url.pathname === '/api/admin/faculty-performance';
  if (!isWorkShift && !isPerformance) return null;
  const auth = await authenticate(req);
  if (auth.error) return send(res, auth.error.status, { error: auth.error.message });
  if (isPerformance) return handleFacultyPerformance(req, res, url);
  return handleWorkShifts(req, res, url, auth);
}

module.exports = { handleStaffInsightsRoute };
