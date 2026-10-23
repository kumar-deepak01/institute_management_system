const { Pool } = require('pg');

const SHEET_NAMES = ['Students', 'Admissions', 'Staff', 'Courses', 'Batches', 'Attendance', 'Fees'];
const TAB_TYPES = {
  Students: { account: 'accounts', 'app-data:student': 'students' },
  Admissions: { application: 'admissions' },
  Staff: { 'app-data:staff': 'staff', 'app-data:payroll': 'payroll' },
  Courses: { 'app-data:course': 'courses' },
  Batches: { 'app-data:batch': 'batches', 'admission-batch': 'batches', config: 'institute_settings' },
  Attendance: { 'app-data:attendance': 'attendance' },
  Fees: { 'app-data:fee': 'fees', 'app-data:payment': 'payments' },
};
const columnFields = {
  students: ['student_id', 'name', 'email', 'roll', 'phone', 'batch_id', 'status', 'joined_at'],
  staff: ['employee_id', 'name', 'email', 'phone', 'role', 'status'],
  admissions: ['name', 'gender', 'date_of_birth', 'batch_id', 'batch_name', 'mobile', 'email', 'address', 'photo_path', 'father_name', 'mother_name', 'guardian_phone', 'previous_school', 'previous_year_percent', 'declaration_accepted_at', 'status', 'applied_at', 'admin_notes', 'reject_reason', 'status_history', 'student_id'],
  courses: ['name', 'status'], batches: ['name', 'course_id', 'course_name', 'active'],
  attendance: ['student_id', 'batch_id', 'attendance_date', 'status', 'marked_by'],
  fees: ['student_id', 'description', 'amount', 'due_date', 'status'],
  payments: ['fee_id', 'student_id', 'amount', 'paid_at', 'status', 'receipt_number'],
  payroll: ['employee_id', 'amount', 'paid_at', 'status'],
  assignments: ['title', 'batch_id', 'due_date', 'status', 'created_by'],
  assignment_submissions: ['assignment_id', 'student_id', 'status', 'submitted_at'],
  class_messages: ['body', 'sent_by'],
  institute_settings: ['institute_name', 'academic_year', 'contact_email', 'timezone'],
};
const jsonFields = new Set(['status_history', 'config']);
let pool;
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    const error = new Error('PostgreSQL is not configured. Set DATABASE_URL in server/.env.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 12000,
  });
  return pool;
}
function rowKind(record) { return record?._type === 'app-data' ? `app-data:${record.collection}` : record?._type; }
function recordTable(tab, record) { return TAB_TYPES[tab]?.[rowKind(record)] || null; }
function first(...values) { return values.find(value => value !== undefined && value !== null && value !== '') ?? null; }
function toDate(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function projectValues(table, record) {
  const id = String(record.id || record.applicationNo || '');
  const map = {
  accounts: { id, email: record.email, role: record.role, name: record.name, student_id: first(record.student_id, record.studentId), password_hash: first(record.password_hash, record.passwordHash), password_salt: first(record.password_salt, record.passwordSalt), must_change_password: Boolean(first(record.must_change_password, record.mustChangePassword, false)), session_version: Number(first(record.session_version, record.sessionVersion, 0)), record_json: record },
    students: { id, student_id: first(record.student_id, record.studentId, id), name: record.name, email: record.email, roll: record.roll, phone: record.phone, batch_id: first(record.batch_id, record.batchId), status: record.status, joined_at: toDate(first(record.joined_at, record.joinedAt, record.admissionDate)), record_json: record },
    staff: { id, employee_id: first(record.employee_id, record.employeeId, id), name: record.name, email: record.email, phone: record.phone, role: record.role, status: record.status, record_json: record },
    admissions: { application_no: first(record.application_no, record.applicationNo, id), name: record.name, gender: record.gender, date_of_birth: toDate(record.dateOfBirth), batch_id: first(record.batch_id, record.batchId), batch_name: first(record.batch_name, record.batchName), mobile: record.mobile, email: record.email, address: record.address, photo_path: first(record.photo_path, record.photoFile), father_name: first(record.father_name, record.fatherName), mother_name: first(record.mother_name, record.motherName), guardian_phone: first(record.guardian_phone, record.guardianPhone), previous_school: first(record.previous_school, record.previousSchool), previous_year_percent: first(record.previous_year_percent, record.previousYearPercent), declaration_accepted_at: toDate(first(record.declaration_accepted_at, record.declarationAcceptedAt)), status: record.status, applied_at: toDate(first(record.applied_at, record.appliedAt)) || new Date(), admin_notes: first(record.admin_notes, record.adminNotes), reject_reason: first(record.reject_reason, record.rejectReason), status_history: first(record.status_history, record.statusHistory, []), student_id: first(record.student_id, record.student?.id), record_json: record },
    courses: { id, name: record.name, status: record.status, record_json: record },
    batches: { id, name: record.name, course_id: first(record.course_id, record.courseId), course_name: first(record.course_name, record.course), active: record.active !== false, record_json: record },
    attendance: { id, student_id: first(record.student_id, record.studentId), batch_id: first(record.batch_id, record.batchId), attendance_date: toDate(first(record.attendance_date, record.date)), status: record.status, marked_by: first(record.marked_by, record.markedBy), record_json: record },
    fees: { id, student_id: first(record.student_id, record.studentId), description: record.description, amount: record.amount, due_date: toDate(first(record.due_date, record.dueDate)), status: record.status, record_json: record },
    payments: { id, fee_id: first(record.fee_id, record.feeId), student_id: first(record.student_id, record.studentId), amount: record.amount, paid_at: toDate(first(record.paid_at, record.paidAt, record.date)), status: record.status, receipt_number: first(record.receipt_number, record.receiptNo, record.receiptNumber), record_json: record },
    payroll: { id, employee_id: first(record.employee_id, record.employeeId), amount: record.amount, paid_at: toDate(first(record.paid_at, record.paidAt)), status: record.status, record_json: record },
    institute_settings: { id, institute_name: first(record.institute_name, record.instituteName), academic_year: first(record.academic_year, record.academicYear), contact_email: first(record.contact_email, record.contactEmail), timezone: record.timezone, config: record.config || null, record_json: record },
  };
  return map[table];
}
async function upsertProjected(client, table, record) {
  const columns = table === 'accounts'
    ? ['id', 'email', 'role', 'name', 'student_id', 'password_hash', 'password_salt', 'must_change_password', 'session_version', 'record_json']
    : [...new Set(['id', ...(columnFields[table] || []), ...(table === 'institute_settings' ? ['config'] : []), 'record_json'])];
  const values = projectValues(table, record);
  const recordKey = table === 'admissions' ? values?.application_no : values?.id;
  if (!values || !recordKey) return;
  const actualColumns = columns.map(column => column === 'id' && table === 'admissions' ? 'application_no' : column);
  const actualValues = table === 'admissions' ? { ...values, application_no: values.application_no } : values;
  const parameters = actualColumns.map((column, index) => {
    const value = actualValues[column];
    return jsonFields.has(column) || column === 'record_json' ? JSON.stringify(value ?? null) : value ?? null;
  });
  const placeholders = actualColumns.map((column, i) => `$${i + 1}${jsonFields.has(column) || column === 'record_json' ? '::jsonb' : ''}`);
  const conflictKey = table === 'admissions' ? 'application_no' : 'id';
  const updates = actualColumns.filter(column => column !== conflictKey && !['photo_path', 'photo_updated_at'].includes(column)).map(column => `${column}=excluded.${column}`);
  updates.push('updated_at=now()');
  await client.query(`insert into public.${table} (${actualColumns.join(',')}) values (${placeholders.join(',')}) on conflict (${conflictKey}) do update set ${updates.join(',')}`, parameters);
}
async function deleteProjected(client, tab, record) {
  const table = recordTable(tab, record);
  if (!table) return;
  if (table === 'admissions') await client.query('delete from public.admissions where application_no=$1', [record.applicationNo || record.id]);
  else await client.query(`delete from public.${table} where id=$1`, [record.id]);
}
async function getSheetRecords(tab) {
  if (!SHEET_NAMES.includes(tab)) throw new TypeError(`Unsupported PostgreSQL record group: ${tab}`);
  const { rows } = await getPool().query('select record_json from public.app_records where source_tab=$1 order by record_id', [tab]);
  return rows.map(row => row.record_json);
}
async function appendSheetRecord(tab, record) {
  if (!SHEET_NAMES.includes(tab) || !record || typeof record !== 'object' || !record.id) throw new TypeError('A supported record group and record with an id are required.');
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)', [tab, String(record.id), JSON.stringify(record)]);
    const table = recordTable(tab, record);
    if (table) await upsertProjected(client, table, record);
    await client.query('commit');
    return record;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
async function saveSheetRecords(tab, records) {
  if (!SHEET_NAMES.includes(tab) || !Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || !record.id)) throw new TypeError('A supported record group and records with ids are required.');
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const previous = await client.query('select record_json from public.app_records where source_tab=$1 for update', [tab]);
    const nextIds = new Set(records.map(record => String(record.id)));
    for (const row of previous.rows) if (!nextIds.has(String(row.record_json.id))) await deleteProjected(client, tab, row.record_json);
    await client.query('delete from public.app_records where source_tab=$1', [tab]);
    for (const record of records) {
      await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)', [tab, String(record.id), JSON.stringify(record)]);
      const table = recordTable(tab, record);
      if (table) await upsertProjected(client, table, record);
    }
    await client.query('commit');
    return records;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
async function closePool() { if (pool) { const current = pool; pool = null; await current.end(); } }
module.exports = { SHEET_NAMES, getPool, getSheetRecords, appendSheetRecord, saveSheetRecords, closePool, projectValues, recordTable };
