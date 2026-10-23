'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const calls = [];
const fakeStaff = { id: 'staff-7', staff_key: 'key-7', name: 'Teacher One', email: 'teacher@example.test', employee_id: 'EMP-7', phone: '', qualification: '', specialization: '', experience_years: 0, bio: '', record_json: {} };
const fakeBatch = { id: 'batch-7', name: 'Physics A', course_id: 'course-7', record_json: { teacherId: 'staff-7' } };
const fakeSubject = { id: 'subject-7', name: 'Physics', course_id: 'course-7', batch_id: 'batch-7' };
const pool = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.includes('from public.staff where id=$1')) return { rows: [fakeStaff] };
    if (sql.includes('with batches as') && sql.includes('student_rows as')) return { rows: [{ students: 2, batches: 1, pending_reviews: 1, class_average: 78, today_classes: [], batch_list: [fakeBatch], reviews: [] }] };
    if (sql.trimStart().startsWith('select distinct b.id,b.name')) return { rows: [fakeBatch] };
    if (sql.includes('join public.subjects su on su.id=sa.subject_id')) return { rows: [fakeSubject] };
    if (sql.includes('select distinct s.id,s.name,s.course_id,sa.batch_id')) return { rows: [fakeSubject] };
    if (sql.includes('from public.students s join batches b')) return { rows: [{ id: 'student-7', name: 'Student One', roll: 'R-7', batch_id: 'batch-7', batch_name: 'Physics A', status: 'active', attendance: 92 }] };
    if (sql.startsWith('insert into public.assignments')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('update public.assignment_submissions')) return { rows: [{ id: 'submission-7', status: 'reviewed', record_json: { score: 9, feedback: 'Good work' } }] };
    if (sql.startsWith("insert into public.app_records(source_tab,record_id,record_json) values('Exams'")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("insert into public.app_records(source_tab,record_id,record_json) values('Leave Requests'")) return { rows: [], rowCount: 1 };
    if (sql.includes('from public.payroll p join public.payroll_runs')) return { rows: [{ id: 'pay-7', period_start: '2026-10-01', period_end: '2026-10-31', gross_pay: '45000', deductions: '5400', net_pay: '39600', status: 'finalized', run_status: 'finalized' }] };
    return { rows: [], rowCount: 0 };
  },
  async connect() { return { query: async (sql, params = []) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; }, release() {} }; },
};
const { handleTeacherRoute } = require('../src/controllers/teacherController');
const deps = {
  getPool: () => pool,
  queryWithLimit: task => task(),
  getSession: () => ({ csrfToken: 'csrf-test' }),
  validCsrfRequest: () => true,
  setSession: (_req, res) => res.setHeader('Set-Cookie', 'session-refreshed'),
  resolveSessionAccount: async () => ({ id: 'account-7', role: 'teacher', staffId: 'staff-7', studentId: 'staff-7', name: 'Teacher One', email: 'teacher@example.test' }),
  changeAccountPassword: async (_id, current, password) => current === 'old password' && password === 'a sufficiently long password' ? { id: 'account-7' } : null,
};

async function call(method, path, payload = {}, query = '') {
  const req = { method, headers: {}, async *[Symbol.asyncIterator]() { if (method !== 'GET') yield Buffer.from(JSON.stringify(payload)); } };
  const res = { writeHead(status) { this.statusCode = status; }, setHeader(name, value) { this.headers ||= {}; this.headers[name] = value; }, end(value) { this.body = value; } };
  await handleTeacherRoute(req, res, new URL(`http://test${path}${query}`), deps);
  return { status: res.statusCode, headers: res.headers || {}, body: res.body?.startsWith('%PDF') ? res.body : JSON.parse(res.body || '{}') };
}

test('dashboard returns assigned-teacher stats and handles empty values', async () => {
  calls.length = 0;
  const response = await call('GET', '/api/teacher/dashboard');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.stats, { students: 2, batches: 1, pendingReviews: 1, classAverage: 78 });
  assert.ok(calls.find(item => item.sql.includes('student_rows as'))?.sql.includes('staff_subject_assignments'));
});

test('student listing scopes rows to the authenticated teacher batches', async () => {
  calls.length = 0;
  const response = await call('GET', '/api/teacher/students');
  assert.equal(response.status, 200);
  assert.equal(response.body.records[0].id, 'student-7');
  const query = calls.find(item => item.sql.includes('from public.students s join batches b'));
  assert.deepEqual(query.params, ['staff-7', 'key-7', '']);
  assert.match(query.sql, /public\.staff_subject_assignments/);
});

test('attendance writes use the shared attendance table and assigned batch only', async () => {
  calls.length = 0;
  const response = await call('POST', '/api/teacher/attendance', { batchId: 'batch-7', date: '2026-10-23', records: [{ studentKey: 'student-7', status: 'Present' }] });
  assert.equal(response.status, 200);
  const insert = calls.find(item => item.sql.includes('insert into public.attendance'));
  assert.ok(insert);
  assert.deepEqual(insert.params.slice(1, 4), ['batch-7', '2026-10-23', 'Present']);
  assert.match(insert.sql, /on conflict\(batch_id,student_key,attendance_date\)/);
});

test('attendance refuses batches that are not in the teacher assignment lookup', async () => {
  const response = await call('GET', '/api/teacher/attendance', {}, '?batchId=another-teachers-batch&date=2026-10-23');
  assert.equal(response.status, 403);
});

test('teacher-created homework is stored with teacher and batch ownership', async () => {
  calls.length = 0;
  const response = await call('POST', '/api/teacher/homework', { title: 'Motion practice', batchId: 'batch-7', subjectId: 'subject-7', dueDate: '2026-11-01', maxMarks: 10 });
  assert.equal(response.status, 201);
  assert.equal(response.body.record.staffKey, 'key-7');
  assert.equal(response.body.record.batchId, 'batch-7');
  const insert = calls.find(item => item.sql.startsWith('insert into public.assignments'));
  assert.ok(insert);
  assert.equal(insert.params[2], 'batch-7');
  assert.equal(JSON.parse(insert.params[5]).title, 'Motion practice');
});

test('homework review remains batch-scoped and saves score and feedback', async () => {
  calls.length = 0;
  const response = await call('PATCH', '/api/teacher/homework/homework-7/submissions/submission-7', { score: 9, feedback: 'Good work' });
  assert.equal(response.status, 200);
  assert.equal(response.body.record.status, 'reviewed');
  const update = calls.find(item => item.sql.startsWith('update public.assignment_submissions'));
  assert.ok(update.sql.includes('public.staff_subject_assignments'));
  assert.deepEqual(update.params.slice(0, 2), ['homework-7', 'submission-7']);
});

test('exam creation and leave application write into shared existing records', async () => {
  const exam = await call('POST', '/api/teacher/exams', { title: 'Unit test', batchId: 'batch-7', subjectId: 'subject-7', scheduledAt: '2026-11-02T10:00:00.000Z', totalMarks: 50 });
  assert.equal(exam.status, 201);
  assert.equal(calls.find(item => item.sql.startsWith("insert into public.app_records(source_tab,record_id,record_json) values('Exams'")).params[0], exam.body.record.id);
  const leave = await call('POST', '/api/teacher/leave', { leaveType: 'Casual', startDate: '2026-11-03', endDate: '2026-11-03', reason: 'Personal appointment' });
  assert.equal(leave.status, 201);
  assert.equal(leave.body.record.staffId, 'staff-7');
});

test('password change verifies the current credential and refreshes the session', async () => {
  const response = await call('POST', '/api/teacher/password', { currentPassword: 'old password', password: 'a sufficiently long password', confirmPassword: 'a sufficiently long password' });
  assert.equal(response.status, 200);
  assert.equal(response.headers['Set-Cookie'], 'session-refreshed');
});

test('teacher payslips query only the authenticated staff key and finalized runs', async () => {
  calls.length = 0;
  const response = await call('GET', '/api/teacher/payslips');
  assert.equal(response.status, 200);
  assert.equal(response.body.records[0].netPay, 39600);
  const query = calls.find(item => item.sql.includes('from public.payroll p join public.payroll_runs'));
  assert.deepEqual(query.params, ['staff-7']);
  assert.match(query.sql, /r\.status in \('finalized','settled'\)/);
});
