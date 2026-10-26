const crypto = require('node:crypto');
const multer = require('multer');
const { getPool: defaultGetPool } = require('../services/postgresStore');
const { queryWithLimit: defaultQueryWithLimit } = require('../services/queryConcurrency');
const { getSupabaseClient, getPhotoBucketName } = require('../lib/supabase');
const { getSession: defaultGetSession, setSession: defaultSetSession, validCsrfRequest: defaultValidCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount: defaultResolveSessionAccount, changeAccountPassword: defaultChangeAccountPassword } = require('./apiController');
const { body, json } = require('../middleware/http');

const send = (res, status, value) => json(res, status, value);
const clean = (value, max = 240) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const uuid = () => crypto.randomUUID();
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 8 } });
const parseMultipart = (req, res) => new Promise((resolve, reject) => multipart.single('file')(req, res, error => error ? reject(error) : resolve()));
const safeLog = (endpoint, step, error) => {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]').replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  console.error(`[teacher] endpoint=${endpoint} step=${step} failed (code=${code}): ${message}`);
};

async function authTeacher(req, deps = {}) {
  const getSession = deps.getSession || defaultGetSession;
  const resolveSessionAccount = deps.resolveSessionAccount || defaultResolveSessionAccount;
  const getPool = deps.getPool || defaultGetPool;
  const queryWithLimit = deps.queryWithLimit || defaultQueryWithLimit;
  const session = getSession(req);
  if (!session) return { status: 401, error: 'Sign in required.' };
  const account = await resolveSessionAccount(req);
  if (!account) return { status: 401, error: 'Sign in required.' };
  if (account.role !== 'teacher') return { status: 403, error: 'Teacher access is required.' };
  const staffId = clean(account.staffId || account.studentId, 120);
  if (!staffId) return { status: 403, error: 'A staff profile is required for this account.' };
  const result = await queryWithLimit(() => getPool().query(`select id,staff_key,name,email,phone,employee_id,qualification,specialization,experience_years,bio,record_json from public.staff where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived','terminated','left') limit 1`, [staffId]));
  if (!result.rows?.[0]) return { status: 403, error: 'The teacher profile is unavailable.' };
  return { session, account, staff: result.rows[0] };
}

const batchScope = `select distinct b.id,b.name,b.course_id,b.record_json
 from public.batches b
 where coalesce(b.active,true)=true and (
   b.record_json->>'teacherId'=$1 or b.record_json->>'teacherId'=$2
   or exists(select 1 from public.staff_subject_assignments sa where sa.staff_id=$1 and sa.batch_id=b.id)
 )`;
const scopeFor = (batchExpr, offset = 0) => `exists(select 1 from public.batches b where b.id = ${batchExpr} and coalesce(b.active,true)=true and (b.record_json->>'teacherId'=$${offset + 1} or b.record_json->>'teacherId'=$${offset + 2} or exists(select 1 from public.staff_subject_assignments sa where sa.staff_id=$${offset + 1} and sa.batch_id=b.id)))`;
const dayName = date => new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
function dateParam(value) { const date = clean(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10); }
function normalizeHomework(row) {
  const data = row.record_json || {};
  return { id: row.id, title: row.title || data.title || '', batchId: row.batch_id, batchName: row.batch_name || '', subjectId: data.subjectId || '', subject: data.subject || row.subject_name || '', dueDate: row.due_date ? String(row.due_date).slice(0, 10) : '', type: data.type || 'Homework', maxMarks: Number(data.maxMarks || 10), description: data.description || '', allowLate: Boolean(data.allowLate), status: row.status || 'Assigned', submissions: Number(row.submissions || 0), pending: Number(row.pending || 0), createdAt: row.created_at };
}
function parseJson(row) { return row?.record_json && typeof row.record_json === 'object' ? row.record_json : {}; }

async function handleTeacherRoute(req, res, url, deps = {}) {
  if (!url.pathname.startsWith('/api/teacher/')) return null;
  const getPool = deps.getPool || defaultGetPool;
  const queryWithLimit = deps.queryWithLimit || defaultQueryWithLimit;
  const validCsrfRequest = deps.validCsrfRequest || defaultValidCsrfRequest;
  const setSession = deps.setSession || defaultSetSession;
  const changeAccountPassword = deps.changeAccountPassword || defaultChangeAccountPassword;
  const endpoint = url.pathname;
  let auth;
  try { auth = await authTeacher(req, deps); }
  catch (error) { safeLog(endpoint, 'authenticate teacher', error); return send(res, 503, { error: 'Teacher data could not be loaded.' }); }
  if (auth.status) return send(res, auth.status, { error: auth.error });
  const { staff, session } = auth;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !validCsrfRequest(req, session)) return send(res, 403, { error: 'CSRF validation failed.' });
  const path = endpoint.replace(/\/$/, '');
  let input = {};
  if (req.method === 'POST' && path === '/api/teacher/shared-files') {
    try { await parseMultipart(req, res); input = req.body || {}; }
    catch (error) { return send(res, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, { error: error.code === 'LIMIT_FILE_SIZE' ? 'The file must be 50 MB or smaller.' : 'Choose a supported file.' }); }
  }
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    if (!(req.method === 'POST' && path === '/api/teacher/shared-files')) {
      try { input = await body(req, 128 * 1024); } catch { return send(res, 400, { error: 'Invalid request body.' }); }
    }
  }
  const pool = getPool();
  const staffKey = String(staff.staff_key || '');
  const staffId = String(staff.id);
  const scopedValues = [staffId, staffKey];
  const context = async () => {
    const [batches, subjects] = await Promise.all([
      queryWithLimit(() => pool.query(`${batchScope} order by b.name,b.id`, scopedValues)),
      queryWithLimit(() => pool.query(`select distinct su.id,su.name,su.course_id,sa.batch_id from public.staff_subject_assignments sa join public.subjects su on su.id=sa.subject_id where sa.staff_id=$1 and lower(coalesce(su.status,'active')) not in ('inactive','archived') order by su.name,su.id`, [staffId])),
    ]);
    const batchRows = batches.rows || [];
    const known = new Map(batchRows.map(row => [row.id, row]));
    for (const row of subjects.rows || []) if (row.batch_id && !known.has(row.batch_id)) {
      const extra = await pool.query(`select id,name,course_id,record_json from public.batches where id=$1 and coalesce(active,true)=true`, [row.batch_id]);
      if (extra.rows?.[0]) known.set(extra.rows[0].id, extra.rows[0]);
    }
    const batchList = Array.from(known.values());
    let subjectRows = subjects.rows || [];
    if (batchList.length) {
      const rs = await queryWithLimit(() => pool.query(`select distinct s.id,s.name,s.course_id,sa.batch_id from public.subjects s left join public.staff_subject_assignments sa on sa.subject_id=s.id and sa.staff_id=$1 where s.course_id=any($2::text[]) and lower(coalesce(s.status,'active')) not in ('inactive','archived') order by s.name,s.id`, [staffId, [...new Set(batchList.map(row => row.course_id).filter(Boolean))]]));
      const merged = new Map(subjectRows.map(row => [row.id, row]));
      for (const row of rs.rows || []) if (!merged.has(row.id)) merged.set(row.id, row);
      subjectRows = Array.from(merged.values());
    }
    return { batches: batchList.map(row => ({ id: row.id, name: row.name || parseJson(row).name || row.id, courseId: row.course_id || '' })), subjects: subjectRows.map(row => ({ id: row.id, name: row.name, courseId: row.course_id || '', batchId: row.batch_id || '' })) };
  };

  try {
    if (req.method === 'GET' && (path === '/api/teacher/context' || path === '/api/teacher/lookups')) {
      const refs = await context();
      const profile = { id: staff.id, name: staff.name || auth.account.name || '', email: staff.email || auth.account.email || '', phone: staff.phone || '', employeeId: staff.employee_id || '', qualification: staff.qualification || '', specialization: staff.specialization || '', experience: Number(staff.experience_years || 0), bio: staff.bio || '', subjects: refs.subjects.map(item => item.name) };
      return send(res, 200, { ...refs, profile, today: dateParam(url.searchParams.get('date')) });
    }

    if (req.method === 'GET' && path === '/api/teacher/dashboard') {
      const date = dateParam(url.searchParams.get('date'));
      const sql = `with batches as (${batchScope}), student_rows as (
        select distinct s.id,s.name,s.roll,s.batch_id from public.students s join batches b on b.id=s.batch_id where lower(coalesce(s.status,'active')) not in ('inactive','dropped','archived')
      ), homework as (
        select a.id,a.title,a.batch_id,a.due_date,a.record_json,a.status from public.assignments a join batches b on b.id=a.batch_id
      )
      select (select count(*)::int from student_rows) students,(select count(*)::int from batches) batches,
        (select count(sub.id)::int from homework h join public.assignment_submissions sub on sub.assignment_id=h.id where lower(coalesce(sub.status,'submitted')) in ('submitted','pending','review')) pending_reviews,
        (select coalesce(round(avg(case when coalesce(ar.record_json->>'score','') ~ '^\\d+(\\.\\d+)?$' then (ar.record_json->>'score')::numeric end)),0)::int from public.app_records ar where ar.source_tab in ('Results','Exam Results') and exists(select 1 from batches b where b.id=ar.record_json->>'batchId')) class_average,
        coalesce((select jsonb_agg(jsonb_build_object('id',t.record_id,'title',t.record_json->>'title','batchId',t.record_json->>'batchId','batchName',b.name,'subject',coalesce(t.record_json->>'subjectName',t.record_json->>'subject'),'day',t.record_json->>'day','startTime',t.record_json->>'startTime','endTime',t.record_json->>'endTime','room',t.record_json->>'room','hostUrl',t.record_json->>'hostUrl') order by t.record_json->>'startTime') from public.app_records t left join public.batches b on b.id=t.record_json->>'batchId' where t.source_tab='Timetable' and coalesce(t.record_json->>'staffKey','') in ($2,$1) and t.record_json->>'day'=$3 and coalesce(t.record_json->>'dateFrom','0001-01-01')<=$4 and coalesce(t.record_json->>'dateTo','9999-12-31')>=$4),'[]'::jsonb) today_classes,
        coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'courseId',course_id) order by name) from batches),'[]'::jsonb) batch_list,
        coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'dueDate',h.due_date,'batchName',b.name,'submissions',h.submissions,'pending',h.pending) order by h.due_date nulls last) from (select a.id,a.title,a.due_date,a.batch_id,count(su.id)::int submissions,count(su.id) filter(where lower(coalesce(su.status,'submitted')) in ('submitted','pending','review'))::int pending from public.assignments a join batches b on b.id=a.batch_id left join public.assignment_submissions su on su.assignment_id=a.id group by a.id) h left join public.batches b on b.id=h.batch_id where h.pending>0 limit 5),'[]'::jsonb) reviews`;
      const { rows } = await queryWithLimit(() => pool.query(sql, [...scopedValues, dayName(date), date]));
      const row = rows?.[0] || {};

      // Query today's live classes
      const classesResult = await queryWithLimit(() => pool.query(`
        select
          lc.id, lc.title, lc.topic, lc.batch_id,
          coalesce(b.name, 'All Batches') as batch_name,
          lc.subject_id,
          coalesce(s.name, lc.title, 'Class') as subject_name,
          lc.scheduled_at,
          coalesce(lc.duration_minutes, 60) as duration_minutes,
          lc.recurring_daily,
          coalesce(lc.host_url, lc.meeting_url, '') as host_url,
          tcj.id as join_id,
          tcj.joined_at,
          tcj.status as join_status
        from public.live_classes lc
        left join public.batches b on b.id = lc.batch_id
        left join public.subjects s on s.id = lc.subject_id
        left join public.teacher_class_joins tcj on tcj.class_id = lc.id and tcj.staff_id = $1 and tcj.attendance_date = $3::date
        where (
          lc.teacher_key in ($1, $2)
          or exists (select 1 from public.staff_subject_assignments sa where sa.staff_id = $1 and sa.batch_id = lc.batch_id)
        )
        and (
          coalesce((lc.scheduled_at at time zone 'Asia/Kolkata')::date, lc.scheduled_at::date) = $3::date
          or lc.recurring_daily = true
        )
        and lower(coalesce(lc.status, 'scheduled')) not in ('cancelled', 'deleted')
        order by coalesce(to_char(lc.scheduled_at at time zone 'Asia/Kolkata', 'HH24:MI'), '00:00') asc, lc.id
      `, [staffId, staffKey, date]));

      const now = new Date();
      const todayClasses = (classesResult.rows || []).map(r => {
        const duration = Number(r.duration_minutes || 60);
        let startDt = new Date(r.scheduled_at);
        if (r.recurring_daily) {
          const timePart = new Date(r.scheduled_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
          startDt = new Date(`${date}T${timePart}+05:30`);
        }
        const endDt = new Date(startDt.getTime() + duration * 60 * 1000);
        const startTimeStr = startDt.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });

        let status = 'upcoming';
        let joinedAtStr = '';
        if (r.join_id) {
          status = 'marked';
          joinedAtStr = new Date(r.joined_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
        } else if (now.getTime() > endDt.getTime()) {
          status = 'missed';
        }

        return {
          id: r.id,
          title: r.title,
          subject: r.subject_name,
          batchId: r.batch_id,
          batchName: r.batch_name,
          startTime: startTimeStr,
          durationMinutes: duration,
          scheduledAt: r.scheduled_at,
          hostUrl: r.host_url,
          status,
          isJoined: Boolean(r.join_id),
          joinedAt: joinedAtStr,
          attendanceStatus: r.join_status || ''
        };
      });

      // Monthly Stats
      const statsRes = await queryWithLimit(() => pool.query(`
        with m as (
          select date_trunc('month', $2::date)::date as m_start,
                 (date_trunc('month', $2::date) + interval '1 month - 1 day')::date as m_end
        ),
        joins as (
          select attendance_date, duration_minutes from public.teacher_class_joins, m
          where staff_id = $1 and attendance_date between m.m_start and m.m_end
        ),
        pwr as (
          select work_date, minutes from public.payroll_work_records, m
          where staff_id = $1 and record_kind = 'attendance' and status = 'approved' and work_date between m.m_start and m.m_end
        )
        select
          (select count(distinct d)::int from (
            select attendance_date as d from joins
            union
            select work_date as d from pwr
          ) all_days) as days_present,
          (select count(*)::int from joins) as classes_taken,
          (select coalesce(sum(duration_minutes), 0)::numeric from joins) as join_minutes
      `, [staffId, date]));

      const mRow = statsRes.rows?.[0] || {};
      const daysPresent = Number(mRow.days_present || 0);
      const classesTaken = Number(mRow.classes_taken || 0);
      const teachingHours = Math.round(Number(mRow.join_minutes || 0) / 6) / 10;
      const missedToday = todayClasses.filter(c => c.status === 'missed').length;
      const takenToday = todayClasses.filter(c => c.status === 'marked').length;
      const totalEligible = takenToday + missedToday;
      const attendanceRate = totalEligible > 0 ? Math.round((takenToday / totalEligible) * 100) : (classesTaken > 0 ? 100 : 0);

      const monthlyStats = {
        daysPresent,
        classesTaken,
        teachingHours,
        attendanceRate: attendanceRate || (daysPresent > 0 ? 95 : 100)
      };

      return send(res, 200, {
        stats: {
          students: Number(row.students || 0),
          batches: Number(row.batches || 0),
          pendingReviews: Number(row.pending_reviews || 0),
          classAverage: Number(row.class_average || 0)
        },
        todayClasses,
        monthlyStats,
        batches: row.batch_list || [],
        reviews: row.reviews || [],
        date
      });
    }

    if (req.method === 'GET' && path === '/api/teacher/students') {
      const q = clean(url.searchParams.get('q'), 100);
      const { rows } = await queryWithLimit(() => pool.query(`with batches as (${batchScope}) select s.id,s.name,s.roll,s.batch_id,b.name batch_name,s.status,coalesce(round(100.0*count(a.id) filter(where lower(a.status)='present')/nullif(count(a.id),0)),0)::int attendance from public.students s join batches b on b.id=s.batch_id left join public.attendance a on a.student_key in (s.id,s.student_id) where lower(coalesce(s.status,'active')) not in ('inactive','dropped','archived') and ($3='' or lower(coalesce(s.name,'')||' '||coalesce(s.roll,'')) like '%'||lower($3)||'%') group by s.id,b.name order by s.name,s.id limit 300`, [...scopedValues, q]));
      return send(res, 200, { records: rows.map(row => ({ id: row.id, name: row.name || 'Student', roll: row.roll || '', batchId: row.batch_id, batchName: row.batch_name, status: row.status || 'Active', attendance: Number(row.attendance || 0), risk: Number(row.attendance || 0) < 60 ? 'At risk' : 'Normal' })) });
    }

    if (req.method === 'GET' && path === '/api/teacher/timetable') {
      const { rows } = await queryWithLimit(() => pool.query(`select ar.record_id id,ar.record_json,b.name batch_name,coalesce(s.name,ar.record_json->>'subjectName',ar.record_json->>'subject','') subject_name from public.app_records ar left join public.batches b on b.id=ar.record_json->>'batchId' left join public.subjects s on s.id=ar.record_json->>'subjectId' where ar.source_tab='Timetable' and coalesce(ar.record_json->>'staffKey','') in ($1,$2) order by ar.record_json->>'day',ar.record_json->>'startTime',ar.record_id`, scopedValues));
      const holidays = await pool.query(`select record_id,record_json from public.app_records where source_tab='Holidays' order by record_json->>'startDate'`);
      return send(res, 200, { classes: rows.map(row => ({ id: row.id, ...parseJson(row), batchName: row.batch_name || '', subjectName: row.subject_name || '' })), holidays: (holidays.rows || []).map(row => ({ id: row.record_id, ...parseJson(row) })) });
    }

    if (req.method === 'GET' && path === '/api/teacher/attendance') {
      const refs = await context(); const batchId = clean(url.searchParams.get('batchId'), 120); const date = dateParam(url.searchParams.get('date'));
      if (!batchId) return send(res, 200, { batchId: '', date, records: [] });
      if (!refs.batches.some(row => row.id === batchId)) return send(res, 403, { error: 'This batch is not assigned to you.' });
      const { rows } = await queryWithLimit(() => pool.query(`select s.id,s.name,s.roll,coalesce(a.status,'Absent') status,coalesce(a.record_json->>'checkIn','') check_in from public.students s left join public.attendance a on a.student_key in (s.id,s.student_id) and a.batch_id=s.batch_id and a.attendance_date=$2::date where s.batch_id=$1 and lower(coalesce(s.status,'active')) not in ('inactive','dropped','archived') order by s.name,s.id`, [batchId, date]));
      return send(res, 200, { batchId, date, records: rows.map(row => ({ studentKey: row.id, name: row.name, roll: row.roll || '', status: row.status, checkIn: row.check_in || '' })) });
    }

    if (req.method === 'POST' && path === '/api/teacher/attendance') {
      const batchId = clean(input.batchId, 120), date = dateParam(input.date), records = Array.isArray(input.records) ? input.records : [];
      if (!batchId || records.length > 500) return send(res, 400, { error: 'Choose a batch and provide valid attendance records.' });
      const refs = await context(); if (!refs.batches.some(row => row.id === batchId)) return send(res, 403, { error: 'This batch is not assigned to you.' });
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const record of records) {
          const studentKey = clean(record.studentKey, 120), status = clean(record.status, 20);
          if (!studentKey || !['Present', 'Absent', 'Late', 'Holiday'].includes(status)) continue;
          await client.query(`insert into public.attendance(id,student_id,student_key,batch_id,attendance_date,status,marked_by,record_json) select $1,s.student_id,s.id,$2,$3::date,$4,$5,$6::jsonb from public.students s where s.id=$7 and s.batch_id=$2 on conflict(batch_id,student_key,attendance_date) do update set status=excluded.status,marked_by=excluded.marked_by,record_json=excluded.record_json,updated_at=now()`, [uuid(), batchId, date, status, staffId, JSON.stringify({ status, markedBy: staffId, date }), studentKey]);
        }
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
      return send(res, 200, { saved: true });
    }

    if (req.method === 'GET' && path === '/api/teacher/homework') {
      const { rows } = await queryWithLimit(() => pool.query(`select a.id,a.title,a.batch_id,a.due_date,a.status,a.record_json,a.created_at,b.name batch_name,coalesce(s.name,a.record_json->>'subject','') subject_name,count(sub.id)::int submissions,count(sub.id) filter(where lower(coalesce(sub.status,'submitted')) in ('submitted','pending','review'))::int pending from public.assignments a join public.batches b on b.id=a.batch_id left join public.subjects s on s.id=a.record_json->>'subjectId' left join public.assignment_submissions sub on sub.assignment_id=a.id where ${scopeFor('a.batch_id')} group by a.id,b.name,s.name order by a.created_at desc limit 300`, scopedValues));
      return send(res, 200, { records: rows.map(normalizeHomework) });
    }
    if (req.method === 'POST' && path === '/api/teacher/homework') {
      const title = clean(input.title, 180), batchId = clean(input.batchId, 120), subjectId = clean(input.subjectId, 120), dueDate = clean(input.dueDate, 10);
      if (!title || !batchId || !subjectId || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return send(res, 400, { error: 'Provide a title, batch, subject and due date.' });
      const refs = await context(); if (!refs.batches.some(row => row.id === batchId)) return send(res, 403, { error: 'This batch is not assigned to you.' });
      if (!refs.subjects.some(item => item.id === subjectId && (!item.batchId || item.batchId === batchId))) return send(res, 403, { error: 'This subject is not assigned to you for this batch.' });
      const subject = refs.subjects.find(item => item.id === subjectId);
      const record = { id: uuid(), title, batchId, subjectId, subject: subject?.name || '', type: clean(input.type || 'Homework', 30), maxMarks: Math.min(100000, Math.max(1, Number(input.maxMarks) || 10)), dueDate, description: clean(input.description, 4000), allowLate: Boolean(input.allowLate), status: 'Assigned', staffKey, createdAt: new Date().toISOString() };
      await queryWithLimit(() => pool.query(`insert into public.assignments(id,title,batch_id,due_date,status,created_by,record_json) values($1,$2,$3,$4,'Assigned',$5,$6::jsonb)`, [record.id, title, batchId, dueDate, staffId, JSON.stringify(record)]));
      return send(res, 201, { record });
    }
    const submissionsMatch = path.match(/^\/api\/teacher\/homework\/([^/]+)\/submissions$/);
    if (req.method === 'GET' && submissionsMatch) {
      const assignmentId = decodeURIComponent(submissionsMatch[1]);
      const { rows } = await queryWithLimit(() => pool.query(`select sub.id,sub.student_id,sub.status,sub.submitted_at,sub.record_json,s.name,s.roll from public.assignment_submissions sub join public.students s on s.id=sub.student_id join public.assignments a on a.id=sub.assignment_id where a.id=$1 and ${scopeFor('a.batch_id',1)} order by sub.submitted_at desc nulls last,sub.id`, [assignmentId, ...scopedValues]));
      return send(res, 200, { records: rows.map(row => ({ id: row.id, studentId: row.student_id, studentName: row.name, roll: row.roll || '', status: row.status || 'Submitted', submittedAt: row.submitted_at, ...parseJson(row) })) });
    }
    const reviewMatch = path.match(/^\/api\/teacher\/homework\/([^/]+)\/submissions\/([^/]+)$/);
    if (['PATCH', 'PUT'].includes(req.method) && reviewMatch) {
      const [assignmentId, submissionId] = reviewMatch.slice(1).map(decodeURIComponent);
      const score = Number(input.score), feedback = clean(input.feedback, 4000);
      if (!Number.isFinite(score) || score < 0 || score > 100000) return send(res, 400, { error: 'Enter a valid score.' });
      const { rows } = await queryWithLimit(() => pool.query(`update public.assignment_submissions sub set status='reviewed',record_json=coalesce(sub.record_json,'{}'::jsonb)||jsonb_build_object('score',$3::numeric,'feedback',$4::text,'reviewedBy',$5::text,'reviewedAt',now()),updated_at=now() from public.assignments a where sub.id=$2 and sub.assignment_id=$1 and a.id=sub.assignment_id and ${scopeFor('a.batch_id',4)} returning sub.id,sub.status,sub.record_json`, [assignmentId, submissionId, score, feedback, staffId, staffKey]));
      if (!rows[0]) return send(res, 404, { error: 'Submission was not found in your batches.' });
      return send(res, 200, { record: { id: rows[0].id, status: rows[0].status, ...parseJson(rows[0]) } });
    }

    if (req.method === 'GET' && path === '/api/teacher/exams') {
      const { rows } = await queryWithLimit(() => pool.query(`select ar.record_id,ar.record_json,ar.created_at from public.app_records ar where ar.source_tab in ('Exams','Online Exams','Offline Exams','Test Series') and exists(select 1 from public.batches b where b.id=ar.record_json->>'batchId' and coalesce(b.active,true)=true and (b.record_json->>'teacherId'=$1 or b.record_json->>'teacherId'=$2 or exists(select 1 from public.staff_subject_assignments sa where sa.staff_id=$1 and sa.batch_id=b.id))) order by ar.created_at desc limit 300`, scopedValues));
      return send(res, 200, { records: rows.map(row => ({ id: row.record_id, ...parseJson(row), createdAt: row.created_at })) });
    }
    if (req.method === 'POST' && path === '/api/teacher/exams') {
      const title = clean(input.title, 180), batchId = clean(input.batchId, 120), subjectId = clean(input.subjectId, 120), scheduledAt = clean(input.scheduledAt, 30);
      if (!title || !batchId || !subjectId || !scheduledAt) return send(res, 400, { error: 'Provide an exam title, batch, subject and scheduled date.' });
      const refs = await context(); if (!refs.batches.some(row => row.id === batchId)) return send(res, 403, { error: 'This batch is not assigned to you.' });
      if (!refs.subjects.some(item => item.id === subjectId && (!item.batchId || item.batchId === batchId))) return send(res, 403, { error: 'This subject is not assigned to you for this batch.' });
      const record = { id: uuid(), title, batchId, batchName: refs.batches.find(row => row.id === batchId)?.name || '', subjectId, subjectName: refs.subjects.find(row => row.id === subjectId)?.name || '', scheduledAt, totalMarks: Math.max(1, Number(input.totalMarks) || 100), status: 'Scheduled', staffKey, createdBy: staffId, createdAt: new Date().toISOString() };
      await queryWithLimit(() => pool.query(`insert into public.app_records(source_tab,record_id,record_json) values('Exams',$1,$2::jsonb)`, [record.id, JSON.stringify(record)]));
      return send(res, 201, { record });
    }
    if (req.method === 'GET' && path === '/api/teacher/results') {
      const { rows } = await queryWithLimit(() => pool.query(`select ar.record_id,ar.record_json,ar.created_at from public.app_records ar where ar.source_tab in ('Results','Exam Results') and exists(select 1 from public.batches b where b.id=ar.record_json->>'batchId' and coalesce(b.active,true)=true and (b.record_json->>'teacherId'=$1 or b.record_json->>'teacherId'=$2 or exists(select 1 from public.staff_subject_assignments sa where sa.staff_id=$1 and sa.batch_id=b.id))) order by ar.created_at desc limit 500`, scopedValues));
      return send(res, 200, { records: rows.map(row => ({ id: row.record_id, ...parseJson(row), createdAt: row.created_at })) });
    }

    if (req.method === 'GET' && path === '/api/teacher/shared-files') {
      const { rows } = await queryWithLimit(() => pool.query(`select ar.record_id,ar.record_json,ar.created_at,b.name batch_name from public.app_records ar join public.batches b on b.id=ar.record_json->>'batchId' where ar.source_tab='Teacher Shared Files' and coalesce(ar.record_json->>'teacherId','')=$1 and ${scopeFor("ar.record_json->>'batchId'")} order by ar.created_at desc limit 300`, scopedValues));
      return send(res, 200, { records: rows.map(row => ({ id: row.record_id, ...parseJson(row), batchName: row.batch_name, createdAt: row.created_at })) });
    }
    if (req.method === 'POST' && path === '/api/teacher/shared-files') {
      const file = req.file, title = clean(input.title || file?.originalname, 180), batchId = clean(input.batchId, 120), subjectId = clean(input.subjectId, 120);
      if (!file || !title || !batchId) return send(res, 400, { error: 'Choose a file, title and batch.' });
      const refs = await context(); if (!refs.batches.some(row => row.id === batchId)) return send(res, 403, { error: 'This batch is not assigned to you.' });
      if (subjectId && !refs.subjects.some(item => item.id === subjectId && (!item.batchId || item.batchId === batchId))) return send(res, 403, { error: 'This subject is not assigned to you for this batch.' });
      const detected = await import('file-type').then(module => module.fileTypeFromBuffer(file.buffer));
      const extensions = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      const extension = extensions[detected?.mime]; if (!extension) return send(res, 415, { error: 'Choose a PDF or image file.' });
      const id = uuid(), storagePath = `teacher-files/${staffId}/${id}.${extension}`, bucket = process.env.SUPABASE_CONTENT_BUCKET || getPhotoBucketName();
      const { error: uploadError } = await getSupabaseClient().storage.from(bucket).upload(storagePath, file.buffer, { contentType: detected.mime, upsert: false, cacheControl: '600' });
      if (uploadError) throw new Error('File could not be saved to private storage.');
      const record = { id, teacherId: staffId, staffKey, title, description: clean(input.description, 1000), batchId, subjectId, fileName: clean(file.originalname, 255), contentType: detected.mime, fileSize: file.size, storagePath, createdAt: new Date().toISOString() };
      try { await queryWithLimit(() => pool.query(`insert into public.app_records(source_tab,record_id,record_json) values('Teacher Shared Files',$1,$2::jsonb)`, [id, JSON.stringify(record)])); }
      catch (error) { await getSupabaseClient().storage.from(bucket).remove([storagePath]); throw error; }
      return send(res, 201, { record: { ...record, storagePath: undefined } });
    }
    const sharedFileMatch = path.match(/^\/api\/teacher\/shared-files\/([^/]+)(?:\/(download))?$/);
    if (req.method === 'GET' && sharedFileMatch?.[2]) {
      const { rows } = await queryWithLimit(() => pool.query(`select record_json from public.app_records where source_tab='Teacher Shared Files' and record_id=$1 and record_json->>'teacherId'=$2`, [decodeURIComponent(sharedFileMatch[1]), staffId]));
      if (!rows[0]) return send(res, 404, { error: 'File was not found.' });
      const file = parseJson(rows[0]), bucket = process.env.SUPABASE_CONTENT_BUCKET || getPhotoBucketName();
      const { data, error } = await getSupabaseClient().storage.from(bucket).createSignedUrl(file.storagePath, 300, { download: file.fileName || true });
      if (error || !data?.signedUrl) throw new Error('A temporary file link could not be created.');
      return send(res, 200, { url: data.signedUrl });
    }
    if (req.method === 'DELETE' && sharedFileMatch && !sharedFileMatch[2]) {
      const id = decodeURIComponent(sharedFileMatch[1]);
      const { rows } = await queryWithLimit(() => pool.query(`select record_json from public.app_records where source_tab='Teacher Shared Files' and record_id=$1 and record_json->>'teacherId'=$2`, [id, staffId]));
      if (!rows[0]) return send(res, 404, { error: 'File was not found.' });
      const file = parseJson(rows[0]), bucket = process.env.SUPABASE_CONTENT_BUCKET || getPhotoBucketName();
      const { error } = await getSupabaseClient().storage.from(bucket).remove([file.storagePath]);
      if (error) throw new Error('File could not be removed from private storage.');
      await queryWithLimit(() => pool.query(`delete from public.app_records where source_tab='Teacher Shared Files' and record_id=$1 and record_json->>'teacherId'=$2`, [id, staffId]));
      return send(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/api/teacher/profile') {
      const refs = await context();
      return send(res, 200, { profile: { id: staff.id, name: staff.name || '', email: staff.email || '', phone: staff.phone || '', employeeId: staff.employee_id || '', qualification: staff.qualification || '', specialization: staff.specialization || '', experience: Number(staff.experience_years || 0), bio: staff.bio || '', subjects: refs.subjects.map(item => item.name) } });
    }
    if (req.method === 'PUT' && path === '/api/teacher/profile') {
      const name = clean(input.name, 160), phone = clean(input.phone, 40), qualification = clean(input.qualification, 200), specialization = clean(input.specialization, 200), bio = clean(input.bio, 3000), experience = Math.max(0, Math.min(80, Number(input.experience) || 0));
      if (!name) return send(res, 400, { error: 'Full name is required.' });
      const current = parseJson(staff);
      const subjects = Array.isArray(input.subjects) ? [...new Set(input.subjects.map(value => clean(value, 80)).filter(Boolean))].slice(0, 30) : (current.subjects || []);
      const updated = { ...current, name, phone, qualification, specialization, experienceYears: experience, bio, subjects };
      await queryWithLimit(() => pool.query(`update public.staff set name=$2,phone=$3,qualification=$4,specialization=$5,experience_years=$6,bio=$7,record_json=$8::jsonb,updated_at=now() where id=$1`, [staffId, name, phone, qualification, specialization, experience, bio, JSON.stringify(updated)]));
      return send(res, 200, { profile: { id: staffId, name, email: staff.email, phone, employeeId: staff.employee_id, qualification, specialization, experience, bio, subjects } });
    }
    if (req.method === 'POST' && path === '/api/teacher/password') {
      const currentPassword = String(input.currentPassword || ''), password = String(input.password || ''), confirmPassword = String(input.confirmPassword || '');
      if (!currentPassword || password.length < 10 || password !== confirmPassword) return send(res, 400, { error: password !== confirmPassword ? 'Passwords do not match.' : 'Provide your current password and a new password of at least 10 characters.' });
      try {
        const updatedAccount = await changeAccountPassword(auth.account.id, currentPassword, password);
        if (!updatedAccount) return send(res, 400, { error: 'Current password is incorrect.' });
        setSession(req, res, updatedAccount);
        return send(res, 200, { ok: true });
      } catch (error) {
        if (error.code === 'PASSWORD_POLICY') return send(res, 400, { error: error.message });
        throw error;
      }
    }

    if (req.method === 'GET' && path === '/api/teacher/leave') {
      const [leave, holidays] = await Promise.all([
        queryWithLimit(() => pool.query(`select record_id,record_json,created_at from public.app_records where source_tab='Leave Requests' and lower(coalesce(record_json->>'role','student'))='staff' and coalesce(record_json->>'staffKey',record_json->>'personKey',record_json->>'staffId') in ($1,$2) order by created_at desc limit 200`, scopedValues)),
        queryWithLimit(() => pool.query(`select record_id,record_json from public.app_records where source_tab='Holidays' order by record_json->>'startDate' limit 200`)),
      ]);
      return send(res, 200, { records: (leave.rows || []).map(row => ({ id: row.record_id, ...parseJson(row), createdAt: row.created_at })), holidays: (holidays.rows || []).map(row => ({ id: row.record_id, ...parseJson(row) })) });
    }
    if (req.method === 'POST' && path === '/api/teacher/leave') {
      const startDate = clean(input.startDate, 10), endDate = clean(input.endDate, 10), reason = clean(input.reason, 1000), leaveType = clean(input.leaveType || 'Casual', 80);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || !reason) return send(res, 400, { error: 'Provide valid leave dates and a reason.' });
      const record = { id: uuid(), role: 'staff', personKey: staffId, staffKey, staffId, name: staff.name, leaveType, startDate, endDate, reason, status: 'pending', createdAt: new Date().toISOString() };
      await queryWithLimit(() => pool.query(`insert into public.app_records(source_tab,record_id,record_json) values('Leave Requests',$1,$2::jsonb)`, [record.id, JSON.stringify(record)]));
      return send(res, 201, { record });
    }

    if (req.method === 'GET' && path === '/api/teacher/payslips') {
      const [payrollResult, privResult] = await Promise.all([
        queryWithLimit(() => pool.query(`
          select p.id, p.period_start, p.period_end, p.gross_pay, p.deductions, p.net_pay, p.status, p.paid_at,
                 p.attendance_days, p.payable_hours, p.payroll_run_id, r.status as run_status,
                 p.snapshot_json, p.breakdown_json, p.record_json,
                 pp.id as payment_id, pp.receipt_no, pp.payment_method, pp.transaction_id, pp.payment_date,
                 pp.account_holder_name, pp.bank_name, pp.account_number_masked, pp.ifsc_code, pp.branch, pp.upi_id, pp.remarks, pp.paid_by
          from public.payroll p
          left join public.payroll_runs r on r.id = p.payroll_run_id
          left join public.payroll_payments pp on pp.payroll_id = p.id and pp.status = 'completed'
          where p.employee_key = $1
          order by p.period_start desc limit 120
        `, [staffId])),
        queryWithLimit(() => pool.query(`
          select account_holder_name, bank_name, bank_account_number, ifsc_code, branch, upi_id, payment_mode
          from public.staff_private where staff_id = $1
        `, [staffId]))
      ]);

      const priv = privResult.rows[0] || {};
      const rawAcc = priv.bank_account_number || '';
      const accountMasked = rawAcc ? (rawAcc.length > 4 ? `•••• •••• ${rawAcc.slice(-4)}` : rawAcc) : '';

      const paymentDetails = {
        paymentMode: priv.payment_mode || 'both',
        accountHolderName: priv.account_holder_name || '',
        bankName: priv.bank_name || '',
        accountMasked,
        ifscCode: priv.ifsc_code || '',
        branch: priv.branch || '',
        upiId: priv.upi_id || ''
      };

      const records = payrollResult.rows.map(row => {
        const isPaid = row.status === 'settled' || Boolean(row.receipt_no);
        const payment = isPaid ? {
          receiptNo: row.receipt_no || row.record_json?.payment?.receiptNo,
          paymentMethod: row.payment_method || row.record_json?.payment?.paymentMethod || 'Bank Transfer',
          transactionId: row.transaction_id || row.record_json?.payment?.transactionId || '',
          paymentDate: row.payment_date ? String(row.payment_date).slice(0, 10) : (row.paid_at ? String(row.paid_at).slice(0, 10) : null),
          amount: Number(row.net_pay || 0),
          remarks: row.remarks || row.record_json?.payment?.remarks || '',
          paidBy: row.paid_by || row.record_json?.payment?.paidBy || '',
          accountHolderName: row.account_holder_name,
          bankName: row.bank_name,
          accountMasked: row.account_number_masked,
          ifscCode: row.ifsc_code,
          branch: row.branch,
          upiId: row.upi_id,
        } : null;

        return {
          id: row.id,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          grossPay: Number(row.gross_pay || 0),
          deductions: Number(row.deductions || 0),
          netPay: Number(row.net_pay || 0),
          attendanceDays: Number(row.attendance_days || 0),
          payableHours: Number(row.payable_hours || 0),
          status: isPaid ? 'Paid' : (row.status === 'draft' ? 'Generated' : (row.status || 'Pending')),
          isPaid,
          paidAt: row.paid_at,
          paymentMethod: payment?.paymentMethod || null,
          receiptNo: payment?.receiptNo || null,
          payment,
          period: row.snapshot_json?.period || null,
          breakdown: row.breakdown_json || row.snapshot_json?.calculation || {},
          snapshot: row.snapshot_json || {},
        };
      });

      return send(res, 200, {
        records,
        paymentDetails,
        stats: {
          available: records.filter(r => r.isPaid).length,
          thisYear: records.filter(row => row.isPaid && String(row.periodStart || '').startsWith(String(new Date().getFullYear()))).length,
          lifetimeEarned: records.filter(r => r.isPaid).reduce((sum, row) => sum + row.netPay, 0)
        }
      });
    }
    const slipMatch = path.match(/^\/api\/teacher\/payslips\/([^/]+)$/);
    if (req.method === 'GET' && slipMatch) {
      const { rows } = await queryWithLimit(() => pool.query(`select p.id,p.employee_id,p.employee_key,p.period_start,p.period_end,p.status,p.gross_pay,p.deductions,p.net_pay,p.payable_hours,p.attendance_days,p.snapshot_json,p.breakdown_json,r.status run_status from public.payroll p join public.payroll_runs r on r.id=p.payroll_run_id where p.id=$1 and p.employee_key=$2`, [decodeURIComponent(slipMatch[1]), staffId]));
      if (!rows[0]) return send(res, 404, { error: 'Payslip was not found.' });
      const row = rows[0], snapshot = row.snapshot_json || {}, calc = snapshot.calculation || row.breakdown_json || {};
      const lines = ['Staff Payslip', `Period: ${String(row.period_start).slice(0,10)} - ${String(row.period_end).slice(0,10)}`, `Staff: ${staff.name || 'Teacher'}   Employee ID: ${row.employee_id || staff.employee_id || '-'}`, `Present days: ${Number(row.attendance_days || 0)}   Approved hours: ${Number(row.payable_hours || 0)}`, `Gross pay: INR ${Number(row.gross_pay || 0).toFixed(2)}`, `Deductions: INR ${Number(row.deductions || 0).toFixed(2)}`, `Net pay: INR ${Number(row.net_pay || 0).toFixed(2)}`, `Status: ${row.status || row.run_status}`];
      const esc = value => String(value).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7E]/g, '?');
      const stream = Buffer.from(['BT','/F1 16 Tf','50 790 Td',...lines.flatMap((line,index)=>index?['0 -32 Td',`(${esc(line)}) Tj`]:[`(${esc(line)}) Tj`]),'ET'].join('\n'),'ascii');
      const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',`<< /Length ${stream.length} >>\nstream\n${stream.toString('ascii')}\nendstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
      const chunks=[Buffer.from('%PDF-1.4\n','ascii')], offsets=[0];let size=chunks[0].length;objects.forEach((object,index)=>{offsets.push(size);const chunk=Buffer.from(`${index+1} 0 obj\n${object}\nendobj\n`,'ascii');chunks.push(chunk);size+=chunk.length;});const xref=size;chunks.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`,'ascii'));
      res.writeHead(200, { 'Content-Type':'application/pdf', 'Content-Disposition':`attachment; filename="payslip-${String(row.period_start).slice(0,7)}.pdf"`, 'Cache-Control':'no-store' }); return res.end(Buffer.concat(chunks));
    }

    const takeMatch = path.match(/^\/api\/teacher\/classes\/([^/]+)\/take$/);
    if (req.method === 'POST' && takeMatch) {
      const classId = decodeURIComponent(takeMatch[1]);
      const classRes = await queryWithLimit(() => pool.query(`
        select lc.*, s.name as subject_name, b.name as batch_name
        from public.live_classes lc
        left join public.subjects s on s.id = lc.subject_id
        left join public.batches b on b.id = lc.batch_id
        where lc.id = $1 and (
          lc.teacher_key in ($2, $3)
          or exists (select 1 from public.staff_subject_assignments sa where sa.staff_id = $2 and sa.batch_id = lc.batch_id)
        )
      `, [classId, staffId, staffKey]));

      const classRow = classRes.rows?.[0];
      if (!classRow) return send(res, 404, { error: 'Class was not found or is not assigned to you.' });

      const now = new Date();
      const todayDate = dateParam(input.date || now.toLocaleDateString('en-CA'));
      const durationMinutes = Number(classRow.duration_minutes || 60);

      let scheduledStart = new Date(classRow.scheduled_at);
      if (classRow.recurring_daily) {
        const timePart = new Date(classRow.scheduled_at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
        scheduledStart = new Date(`${todayDate}T${timePart}+05:30`);
      }

      const diffMinutes = (now.getTime() - scheduledStart.getTime()) / (1000 * 60);
      const status = diffMinutes > 8 ? 'Late' : 'Present';
      const timeStr = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });

      // Upsert teacher_class_joins
      const joinId = uuid();
      await queryWithLimit(() => pool.query(`
        insert into public.teacher_class_joins (
          id, class_id, staff_id, staff_key, batch_id, subject_id,
          attendance_date, scheduled_time, scheduled_start,
          joined_at, duration_minutes, status, record_json
        ) values (
          $1, $2, $3, $4, $5, $6,
          $7::date, $8, $9,
          now(), $10, $11, $12::jsonb
        )
        on conflict (staff_id, class_id, attendance_date)
        do update set
          joined_at = excluded.joined_at,
          status = excluded.status,
          record_json = public.teacher_class_joins.record_json || excluded.record_json,
          updated_at = now()
      `, [
        joinId, classId, staffId, staffKey, classRow.batch_id, classRow.subject_id,
        todayDate, timeStr, classRow.scheduled_at,
        durationMinutes, status, JSON.stringify({ auto: true, source: 'zoom' })
      ]));

      // Query day aggregate for staff
      const daySummary = await pool.query(`
        select
          min(to_char(joined_at at time zone 'Asia/Kolkata', 'HH24:MI')) as check_in,
          max(to_char((joined_at + (duration_minutes || ' minutes')::interval) at time zone 'Asia/Kolkata', 'HH24:MI')) as check_out,
          coalesce(sum(duration_minutes), 0)::int as total_minutes,
          bool_or(status = 'Late') as had_late
        from public.teacher_class_joins
        where staff_id = $1 and attendance_date = $2::date
      `, [staffId, todayDate]);

      const sumRow = daySummary.rows?.[0] || {};
      const checkInStr = sumRow.check_in || '10:00';
      const checkOutStr = sumRow.check_out || '11:00';
      const totalMinutes = Number(sumRow.total_minutes || durationMinutes);
      const dayStatus = sumRow.had_late ? 'late' : 'present';

      // Upsert into payroll_work_records for attendance
      const pwrAttendId = 'attend_' + staffId + '_' + todayDate;
      await queryWithLimit(() => pool.query(`
        insert into public.payroll_work_records (
          id, staff_id, work_date, record_kind, source, provider_event_id,
          verification_status, status, minutes, payable_minutes,
          joined_at, record_json, created_by
        ) values (
          gen_random_uuid()::text, $1, $2::date, 'attendance', 'zoom', $3,
          'verified', 'approved', $4, $4,
          now(), $5::jsonb, $1
        )
        on conflict (source, provider_event_id)
        do update set
          minutes = excluded.minutes,
          payable_minutes = excluded.payable_minutes,
          record_json = public.payroll_work_records.record_json || excluded.record_json,
          verification_status = 'verified',
          status = 'approved'
      `, [
        staffId, todayDate, pwrAttendId,
        totalMinutes,
        JSON.stringify({
          attendanceStatus: dayStatus,
          checkIn: checkInStr,
          checkOut: checkOutStr,
          source: 'zoom',
          auto: true
        })
      ]));

      // Upsert into payroll_work_records for teaching
      const pwrTeachId = 'teach_' + staffId + '_' + classId + '_' + todayDate;
      await queryWithLimit(() => pool.query(`
        insert into public.payroll_work_records (
          id, staff_id, class_session_id, work_date, record_kind, source, provider_event_id,
          verification_status, status, minutes, payable_minutes,
          joined_at, scheduled_start, record_json, created_by
        ) values (
          gen_random_uuid()::text, $1, $2, $3::date, 'teaching', 'zoom', $4,
          'verified', 'approved', $5, $5,
          now(), $6, $7::jsonb, $1
        )
        on conflict (source, provider_event_id)
        do update set
          minutes = excluded.minutes,
          payable_minutes = excluded.payable_minutes,
          record_json = public.payroll_work_records.record_json || excluded.record_json,
          verification_status = 'verified',
          status = 'approved'
      `, [
        staffId, classId, todayDate, pwrTeachId,
        durationMinutes, classRow.scheduled_at,
        JSON.stringify({
          title: classRow.title,
          subjectId: classRow.subject_id,
          subjectName: classRow.subject_name || classRow.title,
          batchId: classRow.batch_id,
          batchName: classRow.batch_name,
          classId,
          source: 'zoom'
        })
      ]));

      const hostUrl = classRow.host_url || classRow.meeting_url || '';
      return send(res, 200, {
        ok: true,
        message: 'Attendance marked ✓',
        subject: classRow.subject_name || classRow.title || 'Class',
        batchName: classRow.batch_name || 'All Batches',
        time: timeStr,
        status,
        hostUrl
      });
    }

    if (req.method === 'GET' && path === '/api/teacher/my-attendance') {
      const monthParam = clean(url.searchParams.get('month'), 7) || new Date().toISOString().slice(0, 7);
      const validMonth = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date().toISOString().slice(0, 7);
      const [yearStr, mStr] = validMonth.split('-');
      const year = Number(yearStr);
      const m = Number(mStr);
      const daysInMonth = new Date(year, m, 0).getDate();
      const startDate = `${validMonth}-01`;
      const endDate = `${validMonth}-${String(daysInMonth).padStart(2, '0')}`;

      const [joinsRes, pwrRes, holidaysRes] = await Promise.all([
        queryWithLimit(() => pool.query(`
          select
            tcj.id, tcj.class_id, tcj.attendance_date, tcj.joined_at, tcj.duration_minutes, tcj.status,
            lc.title, coalesce(s.name, lc.title, 'Class') as subject_name, coalesce(b.name, 'All Batches') as batch_name
          from public.teacher_class_joins tcj
          left join public.live_classes lc on lc.id = tcj.class_id
          left join public.subjects s on s.id = tcj.subject_id
          left join public.batches b on b.id = tcj.batch_id
          where tcj.staff_id = $1 and tcj.attendance_date between $2::date and $3::date
          order by tcj.joined_at asc
        `, [staffId, startDate, endDate])),
        queryWithLimit(() => pool.query(`
          select work_date, record_json, minutes, status
          from public.payroll_work_records
          where staff_id = $1 and record_kind = 'attendance' and work_date between $2::date and $3::date
          order by work_date asc
        `, [staffId, startDate, endDate])),
        queryWithLimit(() => pool.query(`
          select record_json from public.app_records where source_tab = 'Holidays'
        `))
      ]);

      const holidays = new Set((holidaysRes.rows || []).map(r => r.record_json?.startDate?.slice(0, 10)).filter(Boolean));

      const joinsByDate = new Map();
      for (const j of joinsRes.rows || []) {
        const d = String(j.attendance_date).slice(0, 10);
        if (!joinsByDate.has(d)) joinsByDate.set(d, []);
        joinsByDate.get(d).push(j);
      }

      const pwrByDate = new Map();
      for (const p of pwrRes.rows || []) {
        const d = String(p.work_date).slice(0, 10);
        pwrByDate.set(d, p);
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const days = [];
      let totalMinutes = 0;
      let totalClasses = 0;
      let presentDaysCount = 0;

      for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${validMonth}-${String(day).padStart(2, '0')}`;
        const dayDate = new Date(`${dateStr}T00:00:00`);
        const weekday = dayDate.toLocaleDateString('en-US', { weekday: 'long' });
        const dayJoins = joinsByDate.get(dateStr) || [];
        const pwr = pwrByDate.get(dateStr);
        const pwrJson = pwr?.record_json || {};

        let status = 'No class';
        let checkIn = '';
        let checkOut = '';
        let dayMinutes = 0;

        if (dayJoins.length > 0) {
          totalClasses += dayJoins.length;
          dayMinutes = dayJoins.reduce((sum, item) => sum + Number(item.duration_minutes || 60), 0);
          totalMinutes += dayMinutes;
          presentDaysCount += 1;
          const hadLate = dayJoins.some(item => item.status === 'Late');
          status = hadLate ? 'Late' : 'Present';
          const firstJoin = dayJoins[0].joined_at;
          const lastJoin = dayJoins[dayJoins.length - 1];
          checkIn = new Date(firstJoin).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
          const lastEnd = new Date(new Date(lastJoin.joined_at).getTime() + (Number(lastJoin.duration_minutes || 60) * 60 * 1000));
          checkOut = lastEnd.toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
        } else if (pwr && (pwrJson.attendanceStatus === 'present' || pwrJson.attendanceStatus === 'late')) {
          presentDaysCount += 1;
          status = pwrJson.attendanceStatus === 'late' ? 'Late' : 'Present';
          checkIn = pwrJson.checkIn || '';
          checkOut = pwrJson.checkOut || '';
          dayMinutes = Number(pwr.minutes || 0);
          totalMinutes += dayMinutes;
        } else if (holidays.has(dateStr)) {
          status = 'Holiday';
        } else if (weekday === 'Sunday') {
          status = 'Sunday';
        } else if (dateStr < todayStr) {
          status = 'Absent';
        }

        days.push({
          date: dateStr,
          day: weekday,
          status,
          classesTaken: dayJoins.length,
          classes: dayJoins.map(j => ({
            id: j.class_id,
            title: j.title,
            subject: j.subject_name,
            batch: j.batch_name,
            durationMinutes: j.duration_minutes,
            joinedAt: new Date(j.joined_at).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }),
            status: j.status
          })),
          checkIn,
          checkOut,
          teachingMinutes: dayMinutes,
          teachingHours: Math.round(dayMinutes / 6) / 10
        });
      }

      const teachingHours = Math.round(totalMinutes / 6) / 10;
      const workingDaysElapsed = days.filter(d => d.date <= todayStr && d.status !== 'Sunday' && d.status !== 'Holiday').length;
      const attendanceRate = workingDaysElapsed > 0 ? Math.min(100, Math.round((presentDaysCount / workingDaysElapsed) * 100)) : 100;

      return send(res, 200, {
        month: validMonth,
        days,
        stats: {
          daysPresent: presentDaysCount,
          classesTaken: totalClasses,
          teachingHours,
          attendanceRate: attendanceRate || 100
        }
      });
    }

    return send(res, 404, { error: 'Teacher route not found.' });
  } catch (error) {
    safeLog(endpoint, req.method === 'GET' ? 'load teacher data' : 'save teacher data', error);
    return send(res, 500, { error: 'This teacher page could not be loaded. Please retry.' });
  }
}

module.exports = { handleTeacherRoute, batchScope, scopeFor, normalizeHomework, dayName };
