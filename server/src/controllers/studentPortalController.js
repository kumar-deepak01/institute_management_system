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
function isStudentEnrolledInClass(studentSubjects, classSubjectId, subjectName = '') {
  if (!classSubjectId) return true;
  if (!Array.isArray(studentSubjects) || studentSubjects.length === 0) return true;
  const cleanSubs = studentSubjects.map(s => String(s || '').trim()).filter(Boolean);
  if (cleanSubs.length === 0) return true;
  const targetId = String(classSubjectId).trim();
  if (cleanSubs.includes(targetId)) return true;
  if (subjectName && cleanSubs.some(s => s.toLowerCase() === String(subjectName).trim().toLowerCase())) return true;
  return false;
}
function query(pool, sql, values = []) {
  return queryWithLimit(() => pool.query(sql, values));
}
async function handleStudentPortalRoute(req, res, url, deps = {}) {
  const joinMatch = url.pathname.match(/^\/api\/student\/(?:portal\/)?live-classes\/([^/]+)\/join$/);
  const getAccount = deps.resolveAccount || resolveSessionAccount;
  const pool = deps.pool || getPool();

  if (joinMatch && req.method === 'POST') {
    if (!(deps.getSession || getSession)(req)) return json(res, 401, { error: 'Sign in required.' });
    let account;
    try { account = await getAccount(req); }
    catch (error) { safeLog('resolve student account', error); return json(res, 503, { error: 'Student account could not be verified.' }); }
    if (!account) return json(res, 401, { error: 'Sign in required.' });
    if (account.role !== 'student' || !account.studentId) return json(res, 403, { error: 'Student access is required.' });

    const classId = joinMatch[1];
    try {
      const classRes = await query(pool, `select lc.*, s.name as subject_name from public.live_classes lc left join public.subjects s on s.id=lc.subject_id where lc.id=$1`, [classId]);
      const classRow = rowsOf(classRes)[0];
      if (!classRow) return json(res, 404, { error: 'Live class not found.' });

      const studentRes = await query(pool, `select id, student_id, batch_id, record_json from public.students where id=$1 or student_id=$1 limit 1`, [String(account.studentId)]);
      const studentRow = rowsOf(studentRes)[0];
      if (!studentRow) return json(res, 404, { error: 'Student profile was not found.' });

      if (classRow.batch_id && studentRow.batch_id && String(classRow.batch_id) !== String(studentRow.batch_id)) {
        return json(res, 403, { error: 'This class belongs to a different batch.' });
      }

      const sRecord = parseRecord(studentRow.record_json);
      const studentSubjects = Array.isArray(sRecord.subjects) ? sRecord.subjects : [];
      if (!isStudentEnrolledInClass(studentSubjects, classRow.subject_id, classRow.subject_name)) {
        return json(res, 403, { error: 'Not enrolled in this subject', demo: true });
      }

      const now = new Date();
      const todayDate = now.toISOString().slice(0, 10);
      const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

      await query(pool, `insert into public.live_class_joins (id, class_id, student_key, batch_id, subject_id, attendance_date, joined_at, status)
        values (gen_random_uuid()::text, $1, $2, $3, $4, $5::date, $6, 'Present')
        on conflict (student_key, class_id) do update set joined_at=excluded.joined_at`,
        [classId, studentRow.id, studentRow.batch_id || classRow.batch_id || '', classRow.subject_id || '', todayDate, now.toISOString()]
      );

      await query(pool, `insert into public.attendance (id, student_id, student_key, batch_id, attendance_date, status, marked_by, record_json)
        values (gen_random_uuid()::text, $1, $1, $2, $3::date, 'Present', 'zoom_join', jsonb_build_object('auto', true, 'classId', $4::text, 'joinedAt', $5::text))
        on conflict (batch_id, student_key, attendance_date) do update set status='Present', updated_at=now()`,
        [studentRow.id, studentRow.batch_id || classRow.batch_id || '', todayDate, classId, now.toISOString()]
      );

      return json(res, 200, {
        ok: true,
        message: 'Attendance marked ✓',
        meetingUrl: classRow.meeting_url || '#',
        subjectName: classRow.subject_name || 'Class',
        date: todayDate,
        time: timeStr
      });
    } catch (error) {
      safeLog('join live class', error);
      return json(res, 500, { error: 'Could not record live class attendance.' });
    }
  }

  if (url.pathname === '/api/student/profile' || url.pathname === endpoint) {
    if (req.method !== 'GET') return json(res, 403, { error: 'Your details are managed by your institute. Contact the administrator to update them.' });
  }

  if (url.pathname !== endpoint) return null;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
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
    liveClasses: () => profile.batchId ? query(pool, `select lc.id,lc.title,lc.topic,lc.provider,lc.subject_id,lc.scheduled_at,lc.duration_minutes,lc.meeting_url,lc.status,
      s.name as subject_name,
      b.name as batch_name,
      st.name as teacher_name,
      exists(select 1 from public.live_class_joins j where j.class_id=lc.id and j.student_key=any($2::text[])) as has_joined
      from public.live_classes lc
      left join public.subjects s on s.id=lc.subject_id
      left join public.batches b on b.id=lc.batch_id
      left join public.staff st on st.id=lc.teacher_key or st.staff_key::text=lc.teacher_key
      where lc.batch_id=$1 and lower(lc.status)='scheduled' order by lc.scheduled_at limit 200`, [profile.batchId, ids]) : Promise.resolve({ rows: [] }),
    joins: () => query(pool, `select j.id,j.class_id,j.subject_id,j.attendance_date,j.joined_at,j.status,lc.title,lc.scheduled_at,sub.name as subject_name,st.name as teacher_name
      from public.live_class_joins j
      left join public.live_classes lc on lc.id=j.class_id
      left join public.subjects sub on sub.id=j.subject_id
      left join public.staff st on st.id::text=lc.teacher_key or st.staff_key::text=lc.teacher_key
      where j.student_key=any($1::text[])
      order by j.joined_at desc limit 50`, idsParam),
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

  const demoWhatsAppNumber = String(process.env.DEMO_WHATSAPP_NUMBER || '917304256203').replace(/[^0-9]/g, '') || '917304256203';
  data.demoWhatsAppNumber = demoWhatsAppNumber;

  data.liveClasses = (Array.isArray(data.liveClasses) ? data.liveClasses : []).map(lc => {
    const isEnrolled = isStudentEnrolledInClass(profile.subjects, lc.subject_id, lc.subject_name);
    if (!isEnrolled) {
      return {
        id: lc.id,
        title: lc.title || lc.topic || 'Online Class',
        subject_name: lc.subject_name || '',
        batch_name: lc.batch_name || profile.batchName || '',
        scheduled_at: lc.scheduled_at,
        teacher_name: lc.teacher_name || 'Faculty',
        enrolled: false,
      };
    }
    return {
      id: lc.id,
      title: lc.title || lc.topic || 'Online Class',
      topic: lc.topic || '',
      provider: lc.provider || 'zoom',
      subject_id: lc.subject_id || '',
      subject_name: lc.subject_name || '',
      batch_name: lc.batch_name || profile.batchName || '',
      scheduled_at: lc.scheduled_at,
      duration_minutes: lc.duration_minutes,
      meeting_url: lc.meeting_url || '',
      status: lc.status || 'scheduled',
      teacher_name: lc.teacher_name || 'Faculty',
      has_joined: Boolean(lc.has_joined),
      enrolled: true,
    };
  });

  const joinRows = Array.isArray(data.joins) ? data.joins : [];
  data.classLog = joinRows.map(r => ({
    id: r.id,
    date: String(r.attendance_date || r.joined_at).slice(0, 10),
    subjectName: r.subject_name || 'Class',
    teacherName: r.teacher_name || 'Faculty',
    time: r.scheduled_at ? new Date(r.scheduled_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '10:30 AM',
    status: r.status || 'Present',
    joinTime: r.joined_at ? new Date(r.joined_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''
  }));

  const teachersMap = { Physics: 'Alok Sir', Chemistry: 'Dr. Verma', Maths: 'R.K. Gupta', Biology: 'Dr. Neha' };
  data.subjectAttendance = data.subjects.map(sub => {
    const isEnrolled = profile.subjects.includes(sub.id) || profile.subjects.some(name => sub.name.toLowerCase().includes(name.toLowerCase()));
    const subJoins = joinRows.filter(j => j.subject_name && j.subject_name.toLowerCase().includes(sub.name.toLowerCase()));
    const attended = subJoins.filter(j => String(j.status).toLowerCase() === 'present').length;
    const held = isEnrolled ? Math.max(attended, sub.name.includes('Physics') ? 12 : sub.name.includes('Maths') ? 10 : sub.name.includes('Chemistry') ? 8 : 4) : 0;
    const missed = Math.max(0, held - attended);
    const rate = held > 0 ? Math.round(attended * 100 / held) : (isEnrolled ? 100 : 0);
    return {
      id: sub.id,
      name: sub.name,
      teacher: teachersMap[sub.name] || 'Faculty',
      held,
      attended,
      missed,
      rate,
      enrolled: isEnrolled
    };
  });

  return json(res, 200, {
    profile,
    data,
    config: { demoWhatsAppNumber },
    panelErrors: entries.filter(([, , error]) => error).map(([name]) => name)
  });
}

module.exports = { handleStudentPortalRoute, isStudentEnrolledInClass, attendanceSummary, ownResultRows, safeLog };
