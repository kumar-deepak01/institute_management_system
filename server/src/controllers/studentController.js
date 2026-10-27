const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const multer = require('multer');
const { getPool } = require('../services/postgresStore');
const { passwordHash } = require('../security/password');
const { getPhotoMetadata, deletePhoto } = require('../services/profileRecords');
const { getPhotoUrls } = require('../services/photoStorage');
const { queryWithLimit } = require('../services/queryConcurrency');
const { isAdminRole, normalizeRole } = require('../middleware/auth');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const receiveImportFile=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1}}).single('file');
const lookupCache = { expiresAt: 0, value: null };
const LOOKUP_TTL_MS = 15000;
const clean = (value, max = 500) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const id = () => crypto.randomUUID();
function safeLog(step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]').replace(/\b(password|hash|cookie|authorization|database_url)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 400);
  console.error(`[students] ${step} failed (code=${code}): ${message}`);
}
function view(row) {
  const data = row.record_json && typeof row.record_json === 'object' ? row.record_json : {};
  return {
    ...data, id: row.id, studentId: row.student_id || row.id, admissionNumber: data.admissionNumber || row.roll || row.student_id || '',
    name: row.name || '', email: row.email || '', phone: row.phone || '', batchId: row.batch_id || '', batchName: row.batch_name || '', courseName: row.course_name || '',
    status: row.status || 'active', joinedAt: row.joined_at, photoPath: row.photo_path || null, photoUpdatedAt: row.photo_updated_at || null,
    attendancePresent: Number(row.attendance_present || 0), attendanceTotal: Number(row.attendance_total || 0), feesDue: Number(row.fees_due || 0),
    feesPaid: Number(row.fees_paid || 0), feeStatus: row.fee_status || '',
  };
}
async function viewWithPhoto(row) { const result=view(row);if(row.photo_path){try{result.photoUrl=(await getPhotoUrls([{path:row.photo_path,updatedAt:row.photo_updated_at}]))[0]}catch(error){safeLog('student photo URL',error);}}return result; }
function filters(url) {
  return { q: clean(url.searchParams.get('q'), 120), batch: clean(url.searchParams.get('batch'), 120), status: clean(url.searchParams.get('status'), 40) };
}
function whereFor(f, values) {
  const where = [];
  if (f.q) { values.push(`%${f.q}%`); where.push(`(s.name ilike $${values.length} or s.email ilike $${values.length} or s.roll ilike $${values.length} or s.student_id ilike $${values.length} or s.record_json->>'admissionNumber' ilike $${values.length})`); }
  if (f.batch) { values.push(f.batch); where.push(`s.batch_id=$${values.length}`); }
  if (f.status) { values.push(f.status); where.push(`lower(coalesce(s.status,''))=lower($${values.length})`); }
  return where.length ? `where ${where.join(' and ')}` : '';
}
function studentListQuery(url, all = false, paginate = true) {
  const values = [], where = all ? '' : whereFor(filters(url), values);
  const sort = url.searchParams.get('sort') || 'admission-asc';
  const orderSpec = ({
    'admission-asc': { expression: 'coalesce(f.roll,f.student_id,f.id)', direction: 'asc' },
    'admission-desc': { expression: 'coalesce(f.roll,f.student_id,f.id)', direction: 'desc' },
    'name-asc': { expression: 'f.name', direction: 'asc', nullsLast: true },
    'name-desc': { expression: 'f.name', direction: 'desc', nullsLast: true },
    'newest': { expression: 'f.joined_at', direction: 'desc', nullsLast: true },
  })[sort] || { expression: 'coalesce(f.roll,f.student_id,f.id)', direction: 'asc' };
  const filteredOrder = `${orderSpec.expression} ${orderSpec.direction}${orderSpec.nullsLast ? ' nulls last' : ''}`;
  const pageOrderExpression = orderSpec.expression.replaceAll('f.', 'p.');
  const pageOrder = `${pageOrderExpression} ${orderSpec.direction}${orderSpec.nullsLast ? ' nulls last' : ''}`;
  const aggregateOrder = `data.order_key ${orderSpec.direction}${orderSpec.nullsLast ? ' nulls last' : ''}`;
  const page=Math.max(1,Number(url.searchParams.get('page'))||1),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||10));
  const paging=all||!paginate?'':` limit $${values.push(limit)} offset $${values.push((page-1)*limit)}`;
  const sql=`with filtered as (
    select s.id,s.student_id,s.name,s.email,s.roll,s.phone,s.batch_id,s.status,s.joined_at,s.record_json,s.photo_path,s.photo_updated_at,
      b.name as batch_name,coalesce(b.course_name,c.name,'') as course_name
    from public.students s left join public.batches b on b.id=s.batch_id left join public.courses c on c.id=b.course_id ${where}
  ), page as (select f.* from filtered f order by ${filteredOrder}${paging}),
  attendance_totals as (
    select a.student_id,
      count(*) filter(where lower(coalesce(a.status,'')) in ('p','present'))::int present,
      count(*)::int total 
    from (
      select student_id, status from public.attendance
      union all
      select student_key as student_id, status from public.live_class_joins
    ) a where a.student_id=any(array(select id from page)) group by a.student_id
  ),
  fee_totals as (select f.student_id,coalesce(sum(f.amount) filter(where lower(coalesce(f.status,'')) in ('pending','unpaid','overdue')),0)::numeric due,coalesce(sum(f.amount) filter(where lower(coalesce(f.status,'')) in ('paid','complete','completed')),0)::numeric paid,case when bool_or(lower(coalesce(f.status,''))='overdue') then 'OVERDUE' when bool_or(lower(coalesce(f.status,'')) in ('pending','unpaid')) then 'UPCOMING' when count(*)>0 then 'PAID' else '' end fee_status from public.fees f where f.student_id=any(array(select id from page)) group by f.student_id),
  payment_totals as (select p.student_id,coalesce(sum(p.amount),0)::numeric paid from public.payments p where p.student_id=any(array(select id from page)) group by p.student_id)
  select coalesce(jsonb_agg(to_jsonb(data)-'total'-'order_key' order by ${aggregateOrder}),'[]'::jsonb) records,
    coalesce(max(data.total),(select count(*)::int from filtered)) total from (
      select p.id,p.student_id,p.name,p.email,p.roll,p.phone,p.batch_id,p.status,p.joined_at,p.record_json,p.photo_path,p.photo_updated_at,p.batch_name,p.course_name,
        coalesce(a.present,0)::int attendance_present,coalesce(a.total,0)::int attendance_total,coalesce(f.due,0)::numeric fees_due,coalesce(pay.paid,f.paid,0)::numeric fees_paid,coalesce(f.fee_status,'') fee_status,
        (select count(*)::int from filtered) total,${pageOrderExpression} order_key
      from page p left join attendance_totals a on a.student_id=p.id left join fee_totals f on f.student_id=p.id left join payment_totals pay on pay.student_id=p.id
  ) data`;
  return { sql, values, page, limit };
}
const studentDetailSql = `select s.id,s.student_id,s.name,s.email,s.roll,s.phone,s.batch_id,s.status,s.joined_at,s.record_json,s.photo_path,s.photo_updated_at,
  b.name as batch_name,coalesce(b.course_name,c.name,'') as course_name,
  coalesce(a.present,0)::int as attendance_present,coalesce(a.total,0)::int as attendance_total,
  coalesce(f.due,0)::numeric as fees_due,coalesce(payments.paid,f.paid,0)::numeric as fees_paid,coalesce(f.fee_status,'') as fee_status
  from public.students s left join public.batches b on b.id=s.batch_id left join public.courses c on c.id=b.course_id
  left join lateral (
    select count(*) filter(where lower(coalesce(status,'')) in ('p','present')) as present,
           count(*) as total
    from (
      select student_id, status from public.attendance where student_id=s.id
      union all
      select student_key as student_id, status from public.live_class_joins where student_key=s.id
    ) att
  ) a on true
  left join lateral (select coalesce(sum(case when lower(coalesce(status,'')) in ('pending','unpaid','overdue') then amount else 0 end),0) as due,coalesce(sum(case when lower(coalesce(status,'')) in ('paid','complete','completed') then amount else 0 end),0) as paid,
    case when bool_or(lower(coalesce(status,''))='overdue') then 'OVERDUE' when bool_or(lower(coalesce(status,'')) in ('pending','unpaid')) then 'UPCOMING' when count(*)>0 then 'PAID' else '' end as fee_status
    from public.fees where student_id=s.id) f on true
  left join lateral (select sum(amount) as paid from public.payments where student_id=s.id) payments on true`;
async function rowsFor(url, all = false, paginate = false) {
  const query=studentListQuery(url,all,paginate);
  const result=await queryWithLimit(()=>getPool().query(query.sql,query.values));
  return Array.isArray(result.rows[0]?.records)?result.rows[0].records:[];
}
const studentStatsCache={expiresAt:0,value:null};
const studentStatsSql=`with attendance_risk as (
    select a.student_id
    from public.attendance a group by a.student_id
    having count(*) filter(where lower(coalesce(a.status,'')) in ('p','present'))*1.0 < count(*)*0.75
  ), fee_risk as (select distinct f.student_id from public.fees f where lower(coalesce(f.status,''))='overdue'),
  risk_students as (select s.id from public.students s left join attendance_risk a on a.student_id=s.id left join fee_risk f on f.student_id=s.id where lower(coalesce(s.status,''))='dropped' or a.student_id is not null or f.student_id is not null)
  select
  (select count(*)::int from public.students)::int total,
  (select count(*) filter(where lower(coalesce(status,''))='active')::int from public.students) active,
  (select count(*) filter(where lower(coalesce(status,''))='dropped')::int from public.students) dropped,
  (select count(*) filter(where joined_at>=date_trunc('month',current_date))::int from public.students) new_month,
  (select count(*)::int from risk_students) at_risk`;
async function getStudentStats() {
  if(studentStatsCache.value&&studentStatsCache.expiresAt>Date.now())return studentStatsCache.value;
  const {rows}=await queryWithLimit(()=>getPool().query(studentStatsSql));
  const row=rows[0]||{};
  studentStatsCache.value={total:Number(row.total||0),active:Number(row.active||0),dropped:Number(row.dropped||0),new_month:Number(row.new_month||0),atRisk:Number(row.at_risk||0)};
  studentStatsCache.expiresAt=Date.now()+15000;
  return studentStatsCache.value;
}
function invalidateStudentCaches(){studentStatsCache.expiresAt=0;studentStatsCache.value=null;lookupCache.expiresAt=0;lookupCache.value=null;}
async function suggestedAdmissionNumber(db=getPool()) {
  const settings=await db.query("select config->>'admissionNumberFormat' as format from public.institute_settings where id=$1 limit 1",['institute-settings']);
  const format=settings.rows[0]?.format||'ADM-{YEAR}-{0000}',year=String(new Date().getFullYear()),yearFormat=format.replaceAll('{YEAR}',year);
  const token=yearFormat.match(/\{(0+)\}/),width=token?.[1].length||4,prefix=token?yearFormat.slice(0,token.index):yearFormat,suffix=token?yearFormat.slice((token.index||0)+token[0].length):'';
  const {rows}=await db.query("select coalesce(record_json->>'admissionNumber',roll,'') as admission_number from public.students");
  let max=0;for(const row of rows){const value=String(row.admission_number||'');if(value.startsWith(prefix)&&value.endsWith(suffix)){const number=value.slice(prefix.length,suffix?value.length-suffix.length:undefined);if(/^\d+$/.test(number))max=Math.max(max,Number(number));}}
  return token?`${prefix}${String(max+1).padStart(width,'0')}${suffix}`:yearFormat;
}
function validateStudent(input, { creating = true } = {}) {
  const fields = {
    name: clean(input.name, 160), email: clean(input.email, 254).toLowerCase(), phone: clean(input.phone, 40),
    admissionNumber: clean(input.admissionNumber || input.roll, 80), batchId: clean(input.batchId, 120), status: clean(input.status || 'active', 40).toLowerCase(),
    dateOfBirth: clean(input.dateOfBirth, 20), gender: clean(input.gender, 40), bloodGroup: clean(input.bloodGroup, 8), address: clean(input.address, 1000),
    fatherName: clean(input.fatherName, 160), motherName: clean(input.motherName, 160), guardianPhone: clean(input.guardianPhone, 40), parentName: clean(input.parentName || input.fatherName, 160), parentEmail: clean(input.parentEmail, 254).toLowerCase(), parentPhone: clean(input.parentPhone, 40),
    subjects: Array.isArray(input.subjects) ? input.subjects.map(item => clean(item, 120)).filter(Boolean).slice(0, 50) : [],
  };
  if ((creating && fields.name.length < 2) || !fields.name) return { error: 'Enter the student full name.' };
  if (creating && !emailPattern.test(fields.email)) return { error: 'Enter a valid student email address.' };
  if (creating && !/^[+\d() .-]{7,40}$/.test(fields.phone)) return { error: 'Enter a valid student phone number.' };
  if (creating && fields.fatherName.length < 2) return { error: "Enter the father's name." };
  if (fields.parentEmail && !emailPattern.test(fields.parentEmail)) return { error: 'Enter a valid parent email address.' };
  if (fields.parentEmail && fields.parentEmail === fields.email) return { error: 'Student and parent email addresses must be different.' };
  if (fields.status && !['active','inactive','dropped','on hold'].includes(fields.status)) return { error: 'Choose a valid student status.' };
  if (fields.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth)) return { error: 'Enter a valid date of birth.' };
  return { fields };
}
function defaultPassword(role) { return role === 'parent' ? process.env.DEFAULT_PARENT_PASSWORD : process.env.DEFAULT_STUDENT_PASSWORD; }
function passwordConfigError(role) { const value = defaultPassword(role); return !value || value.length < 10; }
function formulaSafe(value) { const text = String(value ?? ''); return /^[=+\-@]/.test(text) ? `'${text}` : text; }
function risk(student) {
  let score = 0; const reasons = [];
  const attendance = student.attendanceTotal ? student.attendancePresent * 100 / student.attendanceTotal : null;
  if (attendance !== null && attendance < 75) { score += attendance < 50 ? 55 : 30; reasons.push(`Attendance is ${Math.round(attendance)}%`); }
  if (student.feeStatus === 'OVERDUE') { score += 35; reasons.push('Overdue fees recorded'); }
  if (student.status.toLowerCase() === 'dropped') { score += 50; reasons.push('Student status is dropped'); }
  score = Math.min(score, 100);
  return { id: student.id, score, level: score >= 60 ? 'High' : score >= 30 ? 'Med' : 'Low', reason: reasons.length ? reasons.join('; ') : 'No attendance, fee, or status risk rule matched' };
}
function csv(rows) {
  const headers = ['Name','Email','Admission Number','Phone','Batch','Course','Status','Attendance %','Fee Due','Fee Paid','Risk'];
  const quote = value => `"${formulaSafe(value).replace(/"/g,'""')}"`;
  const output = [headers.map(quote).join(',')];
  for (const row of rows) { const s=view(row), r=risk(s); output.push([s.name,s.email,s.admissionNumber,s.phone,s.batchName,s.courseName,s.status,s.attendanceTotal ? Math.round(s.attendancePresent*100/s.attendanceTotal) : '',s.feesDue,s.feesPaid,r.level].map(quote).join(',')); }
  return '\uFEFF' + output.join('\r\n');
}
function sendError(res, step, error) { safeLog(step,error); return { status: 503, body: { error: 'Student data is temporarily unavailable. Please retry.' } }; }
function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);cell='';if(row.some(value=>value!==''))rows.push(row);row=[]}else cell+=ch}row.push(cell);if(row.some(value=>value!==''))rows.push(row);if(rows.length<2)return[];const headers=rows.shift().map(value=>value.replace(/^\uFEFF/,'').trim());return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header,values[index]??''])));
}
function normalizeImportRow(source) {
  const normalized=Object.fromEntries(Object.entries(source||{}).map(([key,value])=>[key.toLowerCase().replace(/[^a-z]/g,''),value]));
  const pick=(...keys)=>{const value=keys.map(key=>normalized[key]).find(item=>item!==undefined&&item!==null)??'';return value instanceof Date?value.toISOString().slice(0,10):value&&typeof value==='object'?'':String(value)};
  return {name:pick('name','studentname','fullname'),email:pick('email','emailaddress'),phone:pick('phone','phonenumber','mobile'),admissionNumber:pick('admissionnumber','admissionno','roll'),batchId:pick('batchid'),fatherName:pick('fathername'),motherName:pick('mothername'),parentEmail:pick('parentemail'),parentName:pick('parentname'),parentPhone:pick('parentphone'),guardianPhone:pick('guardianphone'),dateOfBirth:pick('dateofbirth','dob'),gender:pick('gender'),bloodGroup:pick('bloodgroup'),address:pick('address'),subjects:String(pick('subjects')).split(/[;,]/).map(value=>String(value).trim()).filter(Boolean)};
}
async function uploadedImportRows(req,res) {
  await new Promise((resolve,reject)=>receiveImportFile(req,res,error=>error?reject(error):resolve()));
  if(!req.file)throw Object.assign(new Error('Choose a CSV or XLSX file.'),{statusCode:400});
  const isCsv=/\.csv$/i.test(req.file.originalname)||req.file.mimetype==='text/csv';let rows;
  if(isCsv)rows=parseCsv(req.file.buffer.toString('utf8'));
  else {const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(req.file.buffer);const sheet=workbook.worksheets[0];if(!sheet)return[];const headers=sheet.getRow(1).values.slice(1).map(value=>String(value??''));rows=[];for(let index=2;index<=sheet.rowCount;index++){const values=sheet.getRow(index).values.slice(1);if(values.some(value=>value!==null&&value!==undefined&&value!==''))rows.push(Object.fromEntries(headers.map((header,i)=>[header,values[i]??''])));}}
  return rows.map(normalizeImportRow);
}

async function createStudent(client, fields, auditActor) {
  if (passwordConfigError('student') || (fields.parentEmail && passwordConfigError('parent'))) throw Object.assign(new Error('Set DEFAULT_STUDENT_PASSWORD and, when a parent email is provided, DEFAULT_PARENT_PASSWORD to values at least 10 characters long.'), { statusCode: 400 });
  const studentId=id();
  await client.query("select pg_advisory_xact_lock(hashtext('student-admission-number'))");
  const admissionNumber=fields.admissionNumber || await suggestedAdmissionNumber(client);
  const duplicateAdmission=await client.query("select 1 from public.students where roll=$1 or record_json->>'admissionNumber'=$1 limit 1",[admissionNumber]);
  if(duplicateAdmission.rowCount)throw Object.assign(new Error('Admission number is already assigned. Generate a new number or enter a unique one.'),{statusCode:409});
  const accountId=id(), salt=crypto.randomBytes(16).toString('base64url');
  const studentAccount={id:accountId,email:fields.email,role:'student',name:fields.name,studentId,mustChangePassword:true,sessionVersion:0,passwordSalt:salt,passwordHash:await passwordHash(defaultPassword('student'),salt)};
  const parentAccount=fields.parentEmail ? (()=>{const parentSalt=crypto.randomBytes(16).toString('base64url');return {id:id(),email:fields.parentEmail,role:'parent',name:fields.parentName || 'Parent / Guardian',studentId,mustChangePassword:true,sessionVersion:0,passwordSalt:parentSalt,passwordHash:null,_salt:parentSalt};})() : null;
  if(parentAccount) parentAccount.passwordHash=await passwordHash(defaultPassword('parent'),parentAccount._salt);
  const now=new Date().toISOString();
  const record={id:studentId,studentId,admissionNumber,roll:admissionNumber,name:fields.name,email:fields.email,phone:fields.phone,batchId:fields.batchId || '',status:fields.status || 'active',joinedAt:now,gender:fields.gender,dateOfBirth:fields.dateOfBirth,bloodGroup:fields.bloodGroup,address:fields.address,fatherName:fields.fatherName,motherName:fields.motherName,guardianPhone:fields.guardianPhone,parentName:fields.parentName,parentEmail:fields.parentEmail,parentPhone:fields.parentPhone,subjects:fields.subjects,createdBy:auditActor,createdAt:now};
  await client.query(`insert into public.students(id,student_id,name,email,roll,phone,batch_id,status,joined_at,record_json) values($1,$1,$2,$3,$4,$5,nullif($6,''),$7,$8,$9::jsonb)`,[studentId,fields.name,fields.email,admissionNumber,fields.phone,fields.batchId,fields.status || 'active',now,JSON.stringify(record)]);
  await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)', ['Students',studentId,JSON.stringify({_type:'app-data',collection:'student',...record})]);
  for(const account of [studentAccount,parentAccount].filter(Boolean)) {
    const safeAccount={...account}; delete safeAccount._salt;
    await client.query(`insert into public.accounts(id,email,role,name,student_id,password_hash,password_salt,must_change_password,session_version,record_json) values($1,$2,$3,$4,$5,$6,$7,true,0,$8::jsonb)`,[safeAccount.id,safeAccount.email,safeAccount.role,safeAccount.name,studentId,safeAccount.passwordHash,safeAccount.passwordSalt,JSON.stringify(safeAccount)]);
  }
  return record;
}

async function createStudentFromAdmission(client, application, auditActor) {
  const checked = validateStudent({
    name: application.name,
    email: application.email,
    phone: application.mobile,
    admissionNumber: application.applicationNo,
    batchId: application.batchId,
    gender: application.gender,
    dateOfBirth: application.dateOfBirth || '',
    address: application.address || '',
    fatherName: application.fatherName || '',
    motherName: application.motherName || '',
    parentName: application.fatherName || application.motherName || '',
    guardianPhone: application.guardianPhone || '',
    status: 'active',
  }, { creating: false });
  if (checked.error) throw Object.assign(new Error(checked.error), { statusCode: 400 });
  if (!emailPattern.test(checked.fields.email) || !/^[+\d() .-]{7,40}$/.test(checked.fields.phone)) {
    throw Object.assign(new Error('The application needs a valid email address and phone number before approval.'), { statusCode: 400 });
  }
  const duplicate = await client.query('select 1 from public.accounts where lower(email)=any($1::text[])', [[checked.fields.email]]);
  if (duplicate.rowCount) throw Object.assign(new Error('An account already uses this email address. Link the application to the existing student or update its email before approval.'), { statusCode: 409 });
  return createStudent(client, checked.fields, auditActor);
}

async function handleStudentRoute(req,res,url,input,actor) {
  const prefix='/api/admin/students'; if(!url.pathname.startsWith(prefix)) return false;
  if(!actor || !isAdminRole(actor.role)) { res.statusCode=403; res.end(JSON.stringify({error:'Administrator access is required.'})); return true; }
  const send=(status,data,headers={})=>{res.statusCode=status;for(const [key,value] of Object.entries(headers))res.setHeader(key,value);res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));};
  const suffix=url.pathname.slice(prefix.length).replace(/^\//,'');
  try {
    if(suffix==='lookups' && req.method==='GET') {
      if(lookupCache.value&&lookupCache.expiresAt>Date.now())return send(200,lookupCache.value);
      const pool=getPool(),queries=[
        ['batches',"select id,name,course_id,course_name,active from public.batches where coalesce(active,true)=true order by name"],
        ['courses',"select id,name from public.courses where lower(coalesce(status,'active')) not in ('inactive','archived') order by name"],
        ['subjects',"select id,name,course_id from public.subjects where lower(coalesce(status,'active')) not in ('inactive','archived') order by name"],
      ];const output={batches:[],courses:[],subjects:[]};const values=await Promise.all(queries.map(([name,sql])=>queryWithLimit(()=>pool.query(sql)).then(result=>({name,rows:result.rows})).catch(error=>{safeLog(`lookup ${name}`,error);return{name,rows:[]}})));for(const item of values)output[item.name]=item.rows;lookupCache.value=output;lookupCache.expiresAt=Date.now()+LOOKUP_TTL_MS;return send(200,output);
    }
    if(suffix==='next-admission-number' && req.method==='GET') {
      return send(200,{admissionNumber:await suggestedAdmissionNumber()});
    }
    if((suffix==='' || suffix==='export') && req.method==='GET') {
      const all=url.searchParams.get('all')==='1';
      const query=studentListQuery(url,all,suffix===''),listPromise=queryWithLimit(()=>getPool().query(query.sql,query.values));
      const [result,stats]=await Promise.all([listPromise,suffix===''?getStudentStats():Promise.resolve(null)]),rows=Array.isArray(result.rows[0]?.records)?result.rows[0].records:[];
      if(suffix==='export') {
        const format=url.searchParams.get('format')==='xlsx'?'xlsx':'csv';
        if(format==='csv') { const content=csv(rows);res.statusCode=200;res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="my-jee-mentor-students.csv"');res.end(content);return true; }
        const data=rows.map(row=>{const s=view(row),r=risk(s);return {Name:formulaSafe(s.name),Email:formulaSafe(s.email),AdmissionNumber:formulaSafe(s.admissionNumber),Phone:formulaSafe(s.phone),Batch:formulaSafe(s.batchName),Course:formulaSafe(s.courseName),Status:formulaSafe(s.status),AttendancePercent:s.attendanceTotal?Math.round(s.attendancePresent*100/s.attendanceTotal):'',FeeDue:s.feesDue,FeePaid:s.feesPaid,Risk:formulaSafe(r.level)};});
        const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Students'),columns=Object.keys(data[0]||{Name:'',Email:'',AdmissionNumber:'',Phone:'',Batch:'',Course:'',Status:'',AttendancePercent:'',FeeDue:'',FeePaid:'',Risk:''});sheet.columns=columns.map(key=>({header:key,key,width:Math.min(32,Math.max(14,key.length+2))}));sheet.addRows(data);const buffer=Buffer.from(await workbook.xlsx.writeBuffer());res.statusCode=200;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="my-jee-mentor-students.xlsx"');res.end(buffer);return true;
      }
      const mapped=await Promise.all(rows.map(view));
      const photoUrls=await getPhotoUrls(mapped.map(row=>({path:row.photoPath,updatedAt:row.photoUpdatedAt}))).catch(error=>{safeLog('list photo URLs',error);return mapped.map(()=>null)});
      mapped.forEach((row,index)=>{if(photoUrls[index])row.photoUrl=photoUrls[index]});
      const riskRows=mapped.map(row=>risk(row));
      const total=Number(result.rows[0]?.total||0),page=query.page,limit=query.limit;
      return send(200,{records:mapped,total,page,limit,pages:Math.max(1,Math.ceil(total/limit)),stats,riskScores:riskRows});
    }
    if(suffix==='risk-scores' && req.method==='GET') { const rows=await rowsFor(url,true);return send(200,{ruleBased:true,scores:rows.map(row=>({...risk(view(row)),name:row.name||''}))}); }
    if(suffix==='import/preview' && req.method==='POST') {
      const source=(Array.isArray(input.rows)?input.rows:await uploadedImportRows(req,res)).slice(0,501);if(source.length>500)return send(400,{error:'Import up to 500 rows at a time.'});
      const preview=[];const seen=new Set();for(let i=0;i<source.length;i++){const checked=validateStudent(source[i]||{});const item={row:i+2,email:clean(source[i]?.email,254).toLowerCase(),errors:checked.error?[checked.error]:[]};if(item.email&&seen.has(item.email))item.errors.push('Duplicate email in this file.');if(item.email)seen.add(item.email);preview.push(item);}
      const emails=preview.map(p=>p.email).filter(Boolean);if(emails.length){const {rows}=await getPool().query('select lower(email) email from public.accounts where lower(email)=any($1::text[])', [emails]);const existing=new Set(rows.map(r=>r.email));for(const item of preview)if(existing.has(item.email))item.errors.push('Email already belongs to an account.');}
      return send(200,{preview,rows:source,valid:preview.filter(p=>!p.errors.length).length});
    }
    if(suffix==='import' && req.method==='POST') {
      const source=Array.isArray(input.rows)?input.rows:[];if(!source.length||source.length>500)return send(400,{error:'Provide between 1 and 500 student rows.'});
      const validations=source.map(row=>validateStudent(row));if(validations.some(v=>v.error))return send(400,{error:'Fix validation errors before importing.',errors:validations.map((v,i)=>v.error?{row:i+2,error:v.error}:null).filter(Boolean)});
      const client=await getPool().connect();try{await client.query('begin');const created=[];for(const [i,row] of source.entries()){const email=clean(row.email,254).toLowerCase();const duplicate=await client.query('select 1 from public.accounts where lower(email)=$1',[email]);if(duplicate.rowCount)throw Object.assign(new Error(`Row ${i+2}: email already belongs to an account.`),{statusCode:409});created.push(await createStudent(client,validations[i].fields,actor.email));}await client.query('commit');invalidateStudentCaches();return send(201,{created:created.length});}catch(error){await client.query('rollback');if(error.statusCode)return send(error.statusCode,{error:error.message});throw error;}finally{client.release();}
    }
    if(suffix==='bulk' && req.method==='PATCH') {
      const ids=Array.isArray(input.ids)?input.ids.map(String).slice(0,500):[];if(!ids.length)return send(400,{error:'Select at least one student.'});
      const status= input.status===undefined ? null : clean(input.status,40).toLowerCase(),batchId=input.batchId===undefined?null:clean(input.batchId,120);
      if(status!==null&&!['active','inactive','dropped','on hold'].includes(status))return send(400,{error:'Choose a valid status.'});
      const client=await getPool().connect();try{await client.query('begin');await client.query(`update public.students set status=coalesce($2,status),batch_id=case when $3::text is null then batch_id else nullif($3,'') end,record_json=record_json||jsonb_strip_nulls(jsonb_build_object('status',$2,'batchId',$3)),updated_at=now() where id=any($1::text[])`,[ids,status,batchId]);const {rows}=await client.query('select record_id,record_json from public.app_records where source_tab=$1 and record_id=any($2::text[]) for update',['Students',ids]);for(const row of rows){if(row.record_json?._type==='account')continue;const changed={...row.record_json,...(status?{status}:{}),...(batchId!==null?{batchId}:{})};await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',row.record_id,JSON.stringify(changed)]);}await client.query('commit');invalidateStudentCaches();return send(200,{updated:rows.length});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(suffix==='import-template' && req.method==='GET') {const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Students'),data=[{name:'Student Name',email:'student@example.com',phone:'91 9000000000',admissionNumber:'',batchId:'',fatherName:'',parentEmail:''}];sheet.columns=Object.keys(data[0]).map(key=>({header:key,key,width:24}));sheet.addRows(data);const buffer=Buffer.from(await workbook.xlsx.writeBuffer());res.statusCode=200;res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition','attachment; filename="student-import-template.xlsx"');res.end(buffer);return true;}
    if(suffix==='' && req.method==='POST') {
      const checked=validateStudent(input);if(checked.error)return send(400,{error:checked.error});
      const client=await getPool().connect();try{await client.query('begin');const dup=await client.query('select 1 from public.accounts where lower(email)=any($1::text[])',[ [checked.fields.email,...(checked.fields.parentEmail?[checked.fields.parentEmail]:[])] ]);if(dup.rowCount){await client.query('rollback');return send(409,{error:'An account already uses this email address.'});}const record=await createStudent(client,checked.fields,actor.email);await client.query('commit');invalidateStudentCaches();return send(201,{record});}catch(error){try{await client.query('rollback')}catch{}if(error.statusCode)return send(error.statusCode,{error:error.message});if(error.code==='23505')return send(409,{error:'Student email or admission number already exists.'});throw error;}finally{client.release();}
    }
    const match=suffix.match(/^([^/]+)(?:\/(.*))?$/);if(match){const studentId=decodeURIComponent(match[1]),action=match[2]||'';
      if(action==='email'&&req.method==='PATCH'){
        const email=clean(input.email,254).toLowerCase();if(input.confirm!==true)return send(400,{error:'Confirm the audited login email change.'});if(!emailPattern.test(email))return send(400,{error:'Enter a valid email address.'});
        const client=await getPool().connect();try{await client.query('begin');const student=await client.query('select email,record_json from public.students where id=$1 for update',[studentId]);if(!student.rowCount){await client.query('rollback');return send(404,{error:'Student record was not found.'});}const account=await client.query("select id,email,record_json from public.accounts where student_id=$1 and role='student' for update",[studentId]);if(!account.rowCount){await client.query('rollback');return send(404,{error:'Student login account was not found.'});}const existing=await client.query('select 1 from public.accounts where lower(email)=$1 and id<>$2',[email,account.rows[0].id]);if(existing.rowCount){await client.query('rollback');return send(409,{error:'That email address already belongs to an account.'});}const oldEmail=account.rows[0].email,version=Number(account.rows[0].record_json?.sessionVersion||0)+1,accountJson={...account.rows[0].record_json,email,sessionVersion:version},studentJson={...student.rows[0].record_json,email};await client.query('update public.accounts set email=$2,session_version=$3,record_json=$4::jsonb,updated_at=now() where id=$1',[account.rows[0].id,email,version,JSON.stringify(accountJson)]);await client.query('update public.students set email=$2,record_json=$3::jsonb,updated_at=now() where id=$1',[studentId,email,JSON.stringify(studentJson)]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',account.rows[0].id,JSON.stringify({_type:'account',...accountJson})]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',studentId,JSON.stringify({_type:'app-data',collection:'student',...studentJson})]);await client.query('insert into public.student_email_changes(id,student_id,old_email,new_email,changed_by) values($1,$2,$3,$4,$5)',[id(),studentId,oldEmail,email,actor.email]);await client.query('delete from public.login_failures where email=$1',[oldEmail]);await client.query('commit');invalidateStudentCaches();return send(200,{ok:true,email});}catch(error){await client.query('rollback');if(error.code==='23505')return send(409,{error:'That email address already belongs to an account.'});throw error;}finally{client.release();}
      }
      if(action==='reset-password'&&req.method==='POST'){if(passwordConfigError('student'))return send(400,{error:'Set DEFAULT_STUDENT_PASSWORD to a value at least 10 characters long.'});const client=await getPool().connect();try{await client.query('begin');const result=await client.query("select id,email,record_json from public.accounts where student_id=$1 and role='student' for update",[studentId]);if(!result.rowCount){await client.query('rollback');return send(404,{error:'Student login account was not found.'});}const account=result.rows[0],salt=crypto.randomBytes(16).toString('base64url'),hash=await passwordHash(defaultPassword('student'),salt),version=Number(account.record_json?.sessionVersion||0)+1;const updated={...account.record_json,passwordSalt:salt,passwordHash:hash,mustChangePassword:true,sessionVersion:version};await client.query('update public.accounts set password_hash=$2,password_salt=$3,must_change_password=true,session_version=$4,record_json=$5::jsonb,updated_at=now() where id=$1',[account.id,hash,salt,version,JSON.stringify(updated)]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',account.id,JSON.stringify({_type:'account',...updated})]);await client.query('delete from public.login_failures where email=$1',[account.email]);await client.query('commit');invalidateStudentCaches();return send(200,{ok:true});}catch(error){await client.query('rollback');throw error;}finally{client.release();}}
      if(action && req.method==='GET')return send(404,{error:'Student record was not found.'});
      if(!action&&req.method==='GET'){const {rows}=await getPool().query(`${studentDetailSql} where s.id=$1`,[studentId]);return rows[0]?send(200,{record:await viewWithPhoto(rows[0])}):send(404,{error:'Student record was not found.'});}
      if(!action&&req.method==='PUT'){
        const checked=validateStudent(input,{creating:false});if(checked.error)return send(400,{error:checked.error});const f=checked.fields;
        const current=await getPool().query('select record_json from public.students where id=$1',[studentId]);if(!current.rowCount)return send(404,{error:'Student record was not found.'});
        const old=current.rows[0].record_json||{},admissionNumber=f.admissionNumber||old.admissionNumber||old.roll,updated={...old,...f,email:old.email,admissionNumber,roll:admissionNumber};
        const client=await getPool().connect();try{await client.query('begin');await client.query("select pg_advisory_xact_lock(hashtext('student-admission-number'))");const duplicate=await client.query("select 1 from public.students where id<>$1 and (roll=$2 or record_json->>'admissionNumber'=$2) limit 1",[studentId,admissionNumber]);if(duplicate.rowCount){await client.query('rollback');return send(409,{error:'Admission number is already assigned.'});}await client.query(`update public.students set name=$2,phone=$3,batch_id=nullif($4,''),status=$5,roll=$6,record_json=$7::jsonb,updated_at=now() where id=$1`,[studentId,f.name,f.phone,f.batchId,f.status,admissionNumber,JSON.stringify(updated)]);await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Students',studentId,JSON.stringify({_type:'app-data',collection:'student',...updated})]);await client.query('commit');invalidateStudentCaches();return send(200,{record:updated});}catch(error){try{await client.query('rollback')}catch{}throw error;}finally{client.release();}
      }if(!action&&req.method==='DELETE'){const photo=await getPhotoMetadata('students',studentId),client=await getPool().connect();try{await client.query('begin');const accounts=await client.query('select id, role from public.accounts where student_id=$1 for update',[studentId]);const accountIds=accounts.rows.filter(r=>r.role!=='admin').map(r=>r.id);await client.query('delete from public.app_records where source_tab=$1 and record_id=any($2::text[])',['Students',[studentId,...accountIds]]);if(accountIds.length)await client.query("delete from public.accounts where id=any($1::text[]) and role<>'admin'",[accountIds]);const removed=await client.query('delete from public.students where id=$1',[studentId]);await client.query('commit');invalidateStudentCaches();if(removed.rowCount&&photo.photo_path){try{await deletePhoto('students',studentId)}catch(error){safeLog('delete student photo',error)}}return removed.rowCount?send(200,{ok:true}):send(404,{error:'Student record was not found.'});}catch(error){await client.query('rollback');throw error;}finally{client.release();}}
    }
    return send(405,{error:'Method not allowed.'});
  } catch(error){if(error.statusCode)return send(error.statusCode,{error:error.message});if(error.code==='LIMIT_FILE_SIZE')return send(413,{error:'Import files must be 5 MB or smaller.'});const result=sendError(suffix||'list',error);return send(result.status,result.body);}
}

module.exports={handleStudentRoute,formulaSafe,createStudentFromAdmission,invalidateStudentCaches};
