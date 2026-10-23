'use strict';

const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { json } = require('../middleware/http');

const endpoint = '/api/student/portal';
const emptyPanels = () => ({ attendance: [], timetable: [], exams: [], results: [], homework: [], fees: [], downloads: [], videos: [], liveClasses: [], subjects: [] });
const rowsOf = result => Array.isArray(result?.rows) ? result.rows : [];
const parseRecord = value => {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch { return {}; }
};
const cleanError = error => String(error?.message || 'Database query failed')
  .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
  .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/[\r\n\t]+/g, ' ').slice(0, 240);
function safeLog(step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  console.error(`[student] endpoint=${endpoint} step=${step} code=${code} message=${cleanError(error)}`);
}
function attendanceSummary(records) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0, total: records.length };
  for (const row of records) {
    const status = String(row.status || '').toLowerCase();
    if (['p', 'present'].includes(status)) counts.present++;
    else if (['a', 'absent'].includes(status)) counts.absent++;
    else if (status === 'late') counts.late++;
    else if (['e', 'excused', 'h', 'holiday'].includes(status)) counts.excused++;
  }
  const marked = counts.present + counts.absent + counts.late;
  return { ...counts, rate: marked ? Math.round(counts.present * 100 / marked) : null };
}
function ownResultRows(rows, ids) {
  const keys = new Set(ids.filter(Boolean).map(String));
  return rows.filter(row => {
    const record = parseRecord(row.record_json);
    return [record.studentId, record.studentKey, record.student_id, record.studentKeyId].some(value => value != null && keys.has(String(value)));
  }).map(row => {
    const record = parseRecord(row.record_json);
    return { id: row.record_id, title: record.title || record.examName || '', subjectId: record.subjectId || '', subjectName: record.subjectName || record.subject || '', score: record.score ?? null, percentage: record.percentage ?? null, marksObtained: record.marksObtained ?? null, totalMarks: record.totalMarks ?? null, grade: record.grade || '', rank: record.rank ?? null, examDate: record.examDate || record.date || '', createdAt: row.created_at };
  });
}
function query(pool, sql, values = []) {
  return queryWithLimit(() => pool.query(sql, values));
}
async function handleStudentPortalRoute(req, res, url, deps = {}) {
  if (url.pathname !== endpoint) return null;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const getAccount = deps.resolveAccount || resolveSessionAccount;
  const pool = deps.pool || getPool();
  if (!(deps.getSession || getSession)(req)) return json(res, 401, { error: 'Sign in required.' });
  let account;
  try { account = await getAccount(req); }
  catch (error) { safeLog('resolve student account', error); return json(res, 503, { error: 'Student account could not be verified.' }); }
  if (!account) return json(res, 401, { error: 'Sign in required.' });
  if (account.role !== 'student' || !account.studentId) return json(res, 403, { error: 'Student access is required.' });

  let profile;
  let studentCourseId = '';
  try {
    const result = await query(pool, `select s.id,s.student_id,s.name,s.email,s.roll,s.phone,s.batch_id,s.status,s.joined_at,s.record_json,
      b.name as batch_name,b.course_id,c.name as course_name
      from public.students s left join public.batches b on b.id=s.batch_id left join public.courses c on c.id=b.course_id
      where s.id=$1 or s.student_id=$1 limit 1`, [String(account.studentId)]);
    const row = rowsOf(result)[0];
    if (!row) return json(res, 404, { error: 'Student profile was not found.' });
    const record = parseRecord(row.record_json);
    profile = {
      id: String(row.id), studentId: String(row.student_id || row.id), admissionNumber: String(record.admissionNumber || row.roll || row.student_id || row.id),
      name: String(row.name || account.name || 'Student'), email: String(row.email || account.email || ''), phone: String(row.phone || ''),
      batchId: String(row.batch_id || ''), batchName: String(row.batch_name || ''), courseName: String(row.course_name || ''),
      joinedAt: row.joined_at || '', dateOfBirth: String(record.dateOfBirth || record.dob || ''),
      subjects: Array.isArray(record.subjects) ? record.subjects : [], status: String(row.status || 'Active'),
    };
    studentCourseId = String(row.course_id || '');
  } catch (error) { safeLog('load own student profile', error); return json(res, 503, { error: 'Student workspace could not be loaded.' }); }

  const ids = [...new Set([profile.id, profile.studentId, String(account.studentId)].filter(Boolean))];
  const idsParam = [ids];
  const batchParam = [profile.batchId];
  const month = /^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : new Date().toISOString().slice(0, 7);
  const tasks = {
    attendance: () => query(pool, `select attendance_date,status,record_json from public.attendance where student_key=any($1::text[]) and attendance_date >= $2::date and attendance_date < ($2::date + interval '1 month') order by attendance_date desc`, [...idsParam, `${month}-01`]),
    timetable: () => profile.batchId ? query(pool, `select record_id,record_json,created_at from public.app_records where source_tab='Timetable' and record_json->>'batchId'=$1 order by record_json->>'day',record_json->>'startTime',record_id limit 500`, batchParam) : Promise.resolve({ rows: [] }),
    exams: () => profile.batchId ? query(pool, `select record_id,record_json,created_at from public.app_records where source_tab in ('Exams','Online Exams','Offline Exams','Test Series') and record_json->>'batchId'=$1 order by created_at desc limit 300`, batchParam) : Promise.resolve({ rows: [] }),
    results: () => profile.batchId ? query(pool, `select record_id,record_json,created_at from public.app_records where source_tab in ('Results','Exam Results') and record_json->>'batchId'=$1 order by created_at desc limit 500`, batchParam) : Promise.resolve({ rows: [] }),
    homework: () => profile.batchId ? query(pool, `select a.id,a.title,a.due_date,a.status,a.record_json,a.created_at,s.status as submission_status,s.submitted_at,s.record_json as submission_json from public.assignments a left join public.assignment_submissions s on s.assignment_id=a.id and s.student_id=any($2::text[]) where a.batch_id=$1 and lower(coalesce(a.status,'')) not in ('deleted','archived') order by a.due_date nulls last,a.created_at desc limit 500`, [profile.batchId, ...idsParam]) : Promise.resolve({ rows: [] }),
    fees: () => query(pool, `select f.id,f.title,f.total_amount,f.discount_amount,f.fine_amount,f.waived_amount,f.due_date,f.status,f.installment_no,f.installment_count,coalesce(sum(p.amount) filter(where p.reversed_at is null),0)::numeric as amount_paid from public.student_fees f left join public.fee_payments p on p.student_fee_id=f.id and p.student_key=any($1::text[]) where f.student_key=any($1::text[]) group by f.id order by f.due_date nulls last,f.id limit 500`, idsParam),
    downloads: () => query(pool, `select id,title,description,content_type,subject_id,subject_name,external_url,publish_at,expires_at,created_at from public.download_items where lower(status)='published' and (publish_at is null or publish_at<=now()) and (expires_at is null or expires_at>now()) and (subject_id is null or $1='' or subject_id in (select id from public.subjects where course_id=$1)) order by created_at desc limit 500`, [studentCourseId]),
    videos: () => profile.batchId ? query(pool, `select id,title,description,subject_id,chapter,topic,external_url,unlock_at,created_at from public.video_lectures where batch_id=$1 and lower(status)='published' and (unlock_at is null or unlock_at<=now()) order by created_at desc limit 500`, batchParam) : Promise.resolve({ rows: [] }),
    liveClasses: () => profile.batchId ? query(pool, `select id,title,topic,provider,subject_id,scheduled_at,duration_minutes,meeting_url,status from public.live_classes where batch_id=$1 and lower(status)='scheduled' order by scheduled_at limit 200`, batchParam) : Promise.resolve({ rows: [] }),
    subjects: () => studentCourseId ? query(pool, `select s.id,s.name from public.subjects s where s.course_id=$1 order by s.name limit 200`, [studentCourseId]) : Promise.resolve({ rows: [] }),
  };
  const entries = await Promise.all(Object.entries(tasks).map(async ([name, run]) => {
    try { return [name, rowsOf(await run()), null]; }
    catch (error) { safeLog(`load ${name} panel`, error); return [name, [], error]; }
  }));
  const data = emptyPanels();
  for (const [name, rows] of entries) data[name] = rows;
  data.attendance = data.attendance.map(row => ({ date: String(row.attendance_date).slice(0, 10), status: row.status }));
  data.attendanceSummary = attendanceSummary(data.attendance);
  data.timetable = data.timetable.map(row => {
    const record = parseRecord(row.record_json);
    return { id: row.record_id, title: record.title || '', day: record.day || '', startTime: record.startTime || '', endTime: record.endTime || '', subjectName: record.subjectName || record.subject || '', subject: record.subject || '', topic: record.topic || '', teacherName: record.teacherName || '', type: record.type || 'Lecture', dateFrom: record.dateFrom || '', dateTo: record.dateTo || '' };
  });
  data.exams = data.exams.map(row => {
    const record = parseRecord(row.record_json);
    return { id: row.record_id, title: record.title || record.name || '', subjectId: record.subjectId || '', subjectName: record.subjectName || record.subject || '', scheduledAt: record.scheduledAt || record.date || '', status: record.status || '', totalMarks: record.totalMarks ?? null, createdAt: row.created_at };
  });
  data.results = ownResultRows(data.results, ids);
  data.homework = data.homework.map(row => {
    const record = parseRecord(row.record_json);
    const submission = row.submission_json ? parseRecord(row.submission_json) : {};
    return { id: row.id, title: row.title, dueDate: row.due_date, status: row.submission_status || row.status || 'Assigned', submittedAt: row.submitted_at, subjectId: record.subjectId || '', subject: record.subject || '', subjectName: record.subjectName || '', description: record.description || '', submission: row.submission_json ? { feedback: submission.feedback || '', score: submission.score ?? null } : null };
  });
  data.fees = data.fees.map(row => {
    const totalAmount = Number(row.total_amount || 0);
    const reduction = Number(row.discount_amount || 0) + Number(row.waived_amount || 0);
    const paid = Number(row.amount_paid || 0);
    const due = Math.max(0, totalAmount + Number(row.fine_amount || 0) - reduction - paid);
    return { id: row.id, title: row.title, total: Math.max(0, totalAmount - reduction + Number(row.fine_amount || 0)), paid, due, dueDate: row.due_date, status: due === 0 ? 'paid' : row.status, installmentNo: row.installment_no, installmentCount: row.installment_count };
  });
  data.subjects = data.subjects.map(row => ({ id: row.id, name: row.name }));
  return json(res, 200, { profile, data, panelErrors: entries.filter(([, , error]) => error).map(([name]) => name) });
}

module.exports = { handleStudentPortalRoute, attendanceSummary, ownResultRows, safeLog };
