const crypto = require('node:crypto');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');

const entities = {
  'academic-years': { table: 'academic_years', source: 'Academic Years', kind: 'academic-year', fields: ['name','startDate','endDate','status'] },
  courses: { table: 'courses', source: 'Courses', kind: 'course', fields: ['name','description','duration','status'] },
  subjects: { table: 'subjects', source: 'Subjects', kind: 'subject', fields: ['name','courseId','status'] },
  topics: { table: 'topics', source: 'Topics', kind: 'topic', fields: ['name','subjectId','status'] },
  batches: { table: 'batches', source: 'Batches', kind: 'batch', fields: ['name','courseId','academicYearId','teacherId','schedule','startDate','endDate','capacity','active','status'] },
};
const listCache = new Map();
const statsCache = { expiresAt: 0, value: null };
const lookupsCache = { expiresAt: 0, value: null };
const cacheMs = 12000;
const statsSql=`select (select count(*)::int from public.academic_years) academic_years,(select count(*)::int from public.courses) courses,(select count(*)::int from public.subjects) subjects,(select count(*)::int from public.topics) topics,(select count(*)::int from public.batches) batches,(select count(*)::int from public.batches where active is distinct from false and lower(coalesce(record_json->>'status','active'))<>'archived') active_batches,(select count(*)::int from public.batches where active is false or lower(coalesce(record_json->>'status','active'))='archived') inactive_batches,(select count(*)::int from public.students where batch_id is not null) batch_students,(select count(*)::int from public.batches where record_json->>'endDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and record_json->>'endDate'>=to_char(current_date,'YYYY-MM-DD') and record_json->>'endDate'<to_char(current_date+30,'YYYY-MM-DD')) expiring_batches`;
const lookupQueries={
  courses:"select id,name,status from public.courses where lower(coalesce(status,'active')) not in ('inactive','archived') order by name,id",
  subjects:"select id,name,course_id,status from public.subjects where lower(coalesce(status,'active')) not in ('inactive','archived') order by name,id",
  batches:'select id,name,course_id,course_name,active from public.batches where coalesce(active,true)=true order by name,id',
  academicYears:"select id,name,status,start_date,end_date from public.academic_years where lower(coalesce(status,'active')) not in ('inactive','archived') order by start_date desc nulls last,name",
  teachers:"select id,name from public.staff where coalesce(staff_type,'Teacher')='Teacher' and lower(coalesce(status,'active')) not in ('inactive','archived') order by name,id",
};
const clean = (value, max=180) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
const cacheKey = key => `${key}`;
function invalidate() { listCache.clear(); statsCache.expiresAt=0;statsCache.value=null;lookupsCache.expiresAt=0;lookupsCache.value=null; }
function safeLog(endpoint, step, error) {
  const code=String(error?.code||'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40);
  const message=String(error?.message||'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi,'[redacted]').replace(/\b(password|hash|cookie|authorization|database_url)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]').slice(0,400);
  console.error(`[curriculum] endpoint=${endpoint} step=${step} failed (code=${code}): ${message}`);
}
function send(res,status,data){return json(res,status,data);}
function normalize(entity,row) {
  const extra=row.record_json&&typeof row.record_json==='object'?row.record_json:{};
  const batchStatus=entity==='batches'?(String(extra.status||'').toLowerCase()==='archived'?'archived':row.active===false?'inactive':'active'):null;
  const result={...extra,id:row.id,name:row.name||'',status:batchStatus||String(row.status||extra.status||'active').toLowerCase(),updatedAt:row.updated_at||null};
  if(entity==='academic-years')Object.assign(result,{startDate:row.start_date||extra.startDate||'',endDate:row.end_date||extra.endDate||''});
  if(entity==='courses')Object.assign(result,{description:extra.description||'',duration:extra.duration||'',batchCount:Number(row.batch_count||0)});
  if(entity==='academic-years')Object.assign(result,{batchCount:Number(row.batch_count||0)});
  if(entity==='subjects')Object.assign(result,{courseId:row.course_id||'',courseName:row.course_name||extra.courseName||''});
  if(entity==='topics')Object.assign(result,{subjectId:row.subject_id||'',subjectName:row.subject_name||extra.subjectName||'',courseId:row.course_id||extra.courseId||''});
  if(entity==='batches')Object.assign(result,{courseId:row.course_id||'',courseName:row.course_name||'',active:row.active!==false,academicYearId:extra.academicYearId||'',teacherId:extra.teacherId||'',teacherName:row.teacher_name||extra.teacherName||'',schedule:extra.schedule||'',capacity:Math.max(0,Number(extra.capacity)||50),studentCount:Number(row.student_count||0),startDate:extra.startDate||'',endDate:extra.endDate||''});
  return result;
}
async function authenticate(req,endpoint) {
  const session=getSession(req);if(!session)return {status:401,error:'Sign in required.'};
  const account=await resolveSessionAccount(req);if(!account)return {status:401,error:'Sign in required.'};
  if(account.role!=='admin')return {status:403,error:'Administrator access is required.'};
  return {session,account};
}
function positiveInt(value,fallback,max){const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,max):fallback;}
function buildListSql(entity,search,status,parent,academicYear,page,limit){
  const config=entities[entity],values=[],where=[];
  const add=value=>{values.push(value);return `$${values.length}`;};
  if(search)where.push(`lower(t.name) like lower(${add(search)}) || '%'`);
  if(status){const p=add(status);if(entity==='batches')where.push(`case when lower(t.record_json->>'status')='archived' then 'archived' when t.active is distinct from false then 'active' else 'inactive' end=${p}`);else where.push(`lower(coalesce(t.status,'active'))=${p}`);}
  if(parent){
    if(entity==='subjects')where.push(`t.course_id=${add(parent)}`);
    if(entity==='topics')where.push(`t.subject_id=${add(parent)}`);
    if(entity==='batches')where.push(`t.course_id=${add(parent)}`);
  }
  if(entity==='batches'&&academicYear)where.push(`coalesce(t.record_json->>'academicYearId','')=${add(academicYear)}`);
  const clause=where.length?`where ${where.join(' and ')}`:'';
  const offset=(page-1)*limit;
  const joins=entity==='subjects'?'left join public.courses c on c.id=t.course_id':entity==='topics'?'left join public.subjects s on s.id=t.subject_id left join public.courses c on c.id=s.course_id':entity==='batches'?'left join public.courses c on c.id=t.course_id left join public.staff st on st.id=t.record_json->>\'teacherId\'':'';
  const columns=entity==='academic-years'?'t.id,t.name,t.start_date,t.end_date,t.status,t.record_json,t.updated_at,(select count(*)::int from public.batches b where b.record_json->>\'academicYearId\'=t.id) as batch_count'
    :entity==='courses'?'t.id,t.name,t.status,t.record_json,t.updated_at,(select count(*)::int from public.batches b where b.course_id=t.id) as batch_count,t.record_json->>\'duration\' as duration'
    :entity==='subjects'?'t.id,t.course_id,t.name,t.status,t.record_json,t.updated_at,c.name as course_name'
    :entity==='topics'?'t.id,t.subject_id,t.name,t.status,t.record_json,t.updated_at,s.name as subject_name,s.course_id,c.name as course_name'
    :'t.id,t.course_id,t.course_name,t.name,t.active,t.record_json,t.updated_at,st.name as teacher_name,coalesce((select count(*)::int from public.students s where s.batch_id=t.id),0) as student_count';
  return {sql:`select ${columns},count(*) over()::int as total from public.${config.table} t ${joins} ${clause} order by t.updated_at desc,t.name asc limit $${values.length+1} offset $${values.length+2}`,values:[...values,limit,offset]};
}
async function validateParent(client,entity,input){
  if(entity==='subjects'&&input.courseId){const r=await client.query('select 1 from public.courses where id=$1',[input.courseId]);if(!r.rowCount)return 'Select an existing course.';}
  if(entity==='topics'&&input.subjectId){const r=await client.query("select 1 from public.subjects where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')",[input.subjectId]);if(!r.rowCount)return 'Select an active subject.';}
  if(entity==='batches'&&input.courseId){const r=await client.query("select 1 from public.courses where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')",[input.courseId]);if(!r.rowCount)return 'Select an active course.';}
  if(entity==='batches'&&input.academicYearId){const r=await client.query("select 1 from public.academic_years where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')",[input.academicYearId]);if(!r.rowCount)return 'Select an active academic year.';}
  if(entity==='batches'&&input.teacherId){const r=await client.query("select 1 from public.staff where id=$1 and coalesce(staff_type,'Teacher')='Teacher' and lower(coalesce(status,'active')) not in ('inactive','archived')",[input.teacherId]);if(!r.rowCount)return 'Choose an active teacher.';}
  return '';
}
function cleanInput(entity,body,existing={}){
  const result={...existing};
  if(body.name!==undefined)result.name=clean(body.name,160);
  if(body.status!==undefined)result.status=clean(body.status,20).toLowerCase();
  if(body.startDate!==undefined)result.startDate=clean(body.startDate,10);
  if(body.endDate!==undefined)result.endDate=clean(body.endDate,10);
  if(body.description!==undefined)result.description=clean(body.description,1000);
  if(body.duration!==undefined)result.duration=clean(body.duration,80);
  if(body.courseId!==undefined)result.courseId=clean(body.courseId,120);
  if(body.subjectId!==undefined)result.subjectId=clean(body.subjectId,120);
  if(body.academicYearId!==undefined)result.academicYearId=clean(body.academicYearId,120);
  if(body.teacherId!==undefined)result.teacherId=clean(body.teacherId,120);
  if(body.schedule!==undefined)result.schedule=clean(body.schedule,300);
  if(entity==='batches'){
    const capacity=body.capacity===undefined?Number(result.capacity)||50:Number(body.capacity);
    if(!Number.isInteger(capacity)||capacity<1||capacity>5000)throw Object.assign(new Error('Capacity must be between 1 and 5,000.'),{statusCode:400});
    result.capacity=capacity;
  }
  if(body.active!==undefined)result.active=body.active===true;
  if(!result.name||result.name.length<2)throw Object.assign(new Error('Enter a name with at least 2 characters.'),{statusCode:400});
  const validStatuses=entity==='academic-years'?['active','planned','inactive','archived']:['active','inactive','archived'];
  if(!validStatuses.includes(result.status||'active'))throw Object.assign(new Error('Choose a valid status.'),{statusCode:400});
  result.status=result.status||'active';
  for(const key of ['startDate','endDate'])if(result[key]){const parsed=new Date(`${result[key]}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(result[key])||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==result[key])throw Object.assign(new Error('Enter a valid date.'),{statusCode:400});}
  if(result.startDate&&result.endDate&&result.endDate<result.startDate)throw Object.assign(new Error('End date must be on or after the start date.'),{statusCode:400});
  if(entity==='academic-years'&&(!result.startDate||!result.endDate))throw Object.assign(new Error('Start and end dates are required.'),{statusCode:400});
  if(entity==='batches'&&(!result.courseId||!result.academicYearId))throw Object.assign(new Error('Choose a course and academic year.'),{statusCode:400});
  if(entity==='topics'&&!result.subjectId)throw Object.assign(new Error('Choose a subject.'),{statusCode:400});
  if(entity==='batches'){
    if(body.status!==undefined)result.active=result.status==='active';
    else if(body.active!==undefined)result.status=result.active?'active':'inactive';
    else result.active=result.status==='active';
  }
  return result;
}
async function upsert(client,entity,id,value){
  const config=entities[entity],record={...value,id,_type:'app-data',collection:config.kind};
  const name=record.name,status=record.status||'active';
  if(entity==='academic-years')await client.query(`insert into public.academic_years(id,name,start_date,end_date,status,record_json) values($1,$2,nullif($3,'')::date,nullif($4,'')::date,$5,$6::jsonb) on conflict(id) do update set name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,status=excluded.status,record_json=excluded.record_json,updated_at=now()`,[id,name,record.startDate||'',record.endDate||'',status,JSON.stringify(record)]);
  if(entity==='courses')await client.query(`insert into public.courses(id,name,status,record_json) values($1,$2,$3,$4::jsonb) on conflict(id) do update set name=excluded.name,status=excluded.status,record_json=excluded.record_json,updated_at=now()`,[id,name,status,JSON.stringify(record)]);
  if(entity==='subjects')await client.query(`insert into public.subjects(id,course_id,name,status,record_json) values($1,nullif($2,''),$3,$4,$5::jsonb) on conflict(id) do update set course_id=excluded.course_id,name=excluded.name,status=excluded.status,record_json=excluded.record_json,updated_at=now()`,[id,record.courseId||'',name,status,JSON.stringify(record)]);
  if(entity==='topics')await client.query(`insert into public.topics(id,subject_id,name,status,record_json) values($1,nullif($2,''),$3,$4,$5::jsonb) on conflict(id) do update set subject_id=excluded.subject_id,name=excluded.name,status=excluded.status,record_json=excluded.record_json,updated_at=now()`,[id,record.subjectId||'',name,status,JSON.stringify(record)]);
  if(entity==='batches'){
    const relations=await client.query('select c.name as course_name,s.name as teacher_name from public.courses c left join public.staff s on s.id=$2 where c.id=$1',[record.courseId,record.teacherId||null]);
    const courseName=relations.rows[0]?.course_name||'';record.courseName=courseName;record.course=courseName;record.teacherName=relations.rows[0]?.teacher_name||'';
    await client.query(`insert into public.batches(id,name,course_id,course_name,active,record_json) values($1,$2,$3,$4,$5,$6::jsonb) on conflict(id) do update set name=excluded.name,course_id=excluded.course_id,course_name=excluded.course_name,active=excluded.active,record_json=excluded.record_json,updated_at=now()`,[id,name,record.courseId,courseName,record.active!==false,JSON.stringify(record)]);
  }
  await client.query(`insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb) on conflict(source_tab,record_id) do update set record_json=excluded.record_json,updated_at=now()`,[config.source,id,JSON.stringify(record)]);
  return record;
}
async function handleCurriculumRoute(req,res,url){
  const endpoint=url.pathname;
  let auth;try{auth=await authenticate(req,endpoint);}catch(error){safeLog(endpoint,'verify administrator',error);return send(res,500,{error:'Administrator session could not be verified.'});}
  if(auth.status)return send(res,auth.status,{error:auth.error});
  const {session}=auth;
  let input={};
  if(['POST','PATCH'].includes(req.method)){
    if(!validCsrfRequest(req,session))return send(res,403,{error:'CSRF validation failed.'});
    try{input=await body(req,64*1024);}catch{return send(res,400,{error:'Invalid request body.'});}
  }
  if(req.method==='GET'&&endpoint==='/api/admin/curriculum/lookups'){
    if(lookupsCache.value&&lookupsCache.expiresAt>Date.now())return send(res,200,lookupsCache.value);
    const result={courses:[],subjects:[],batches:[],academicYears:[],teachers:[],schemaPending:false};
    const tasks=Object.entries(lookupQueries).map(([key,sql])=>[key,()=>getPool().query(sql)]);
    await Promise.all(tasks.map(([key,run])=>queryWithLimit(run).then(({rows})=>{result[key]=rows.map(row=>key==='academicYears'?{id:row.id,name:row.name,status:row.status,startDate:row.start_date,endDate:row.end_date}:row);}).catch(error=>{safeLog(endpoint,`load ${key}`,error);result.schemaPending=true;})));
    lookupsCache.value=result;lookupsCache.expiresAt=Date.now()+cacheMs;return send(res,200,result);
  }
  if(req.method==='GET'&&endpoint==='/api/admin/curriculum/stats'){
    if(statsCache.value&&statsCache.expiresAt>Date.now())return send(res,200,statsCache.value);
    try{const {rows}=await queryWithLimit(()=>getPool().query(statsSql));statsCache.value=rows[0]||{academic_years:0,courses:0,subjects:0,topics:0,batches:0};statsCache.expiresAt=Date.now()+cacheMs;return send(res,200,statsCache.value);}catch(error){safeLog(endpoint,'load counts',error);return send(res,200,{academic_years:0,courses:0,subjects:0,topics:0,batches:0,schemaPending:true});}
  }
  const batchOverview=endpoint.match(/^\/api\/admin\/curriculum\/batches\/([^/]+)\/overview$/);
  if(req.method==='GET'&&batchOverview){
    let batchId;try{batchId=decodeURIComponent(batchOverview[1]);}catch{return send(res,400,{error:'Invalid batch id.'});}
    try{
      const [batchResult,studentResult,activityResult]=await Promise.all([
        queryWithLimit(()=>getPool().query(`select b.id,b.name,b.course_id,b.course_name,b.active,b.record_json,b.updated_at,c.name as course_lookup_name,st.name as teacher_name from public.batches b left join public.courses c on c.id=b.course_id left join public.staff st on st.id=b.record_json->>'teacherId' where b.id=$1 limit 1`,[batchId])),
        queryWithLimit(()=>getPool().query(`select s.id,s.student_id,s.roll,s.name,s.status,s.record_json,att.present_count,att.total_count from public.students s left join lateral (select count(*) filter(where lower(coalesce(a.status,'')) in ('present','late'))::int present_count,count(*)::int total_count from public.attendance a where a.batch_id=$1 and (a.student_key::text=s.id or a.student_key::text=s.student_id or a.student_id::text=s.id or a.student_id::text=s.student_id)) att on true where s.batch_id=$1 order by lower(coalesce(s.name,'')),s.id limit 100`,[batchId])),
        queryWithLimit(()=>getPool().query(`select (select count(*)::int from public.live_classes l where l.batch_id=$1 and l.status='scheduled' and l.scheduled_at>=date_trunc('week',now()) and l.scheduled_at<date_trunc('week',now())+interval '7 days') weekly_classes,(select count(*)::int from public.app_records ar where ar.source_tab in ('Exams','Online Exams','Offline Exams','Test Series') and ar.record_json->>'batchId'=$1) exams`,[batchId])),
      ]);
      const row=batchResult.rows[0];if(!row)return send(res,404,{error:'Batch not found.'});
      const record=normalize('batches',{...row,course_name:row.course_lookup_name||row.course_name});
      const students=studentResult.rows.map(student=>{const status=String(student.record_json?.status||student.status||'active').toLowerCase();const total=Number(student.total_count||0),rate=total?Math.round(Number(student.present_count||0)*100/total):null;const risk=rate!==null&&rate<50?'High':rate!==null&&rate<75?'Medium':'Low';return{id:student.id,studentId:student.roll||student.record_json?.admissionNumber||student.student_id||'—',name:student.name||student.record_json?.name||'Student',status,risk,attendanceRate:rate};});
      const metrics=activityResult.rows[0]||{};return send(res,200,{record,students,metrics:{studentCount:students.length,capacity:record.capacity,weeklyClasses:Number(metrics.weekly_classes||0),exams:Number(metrics.exams||0)}});
    }catch(error){safeLog(endpoint,'load batch overview',error);return send(res,500,{error:'Batch details could not be loaded.'});}
  }
  const match=endpoint.match(/^\/api\/admin\/curriculum\/([^/]+)(?:\/([^/]+))?$/);
  if(!match)return send(res,404,{error:'Curriculum route not found.'});
  const entity=match[1];let id='';try{id=match[2]?decodeURIComponent(match[2]):'';}catch{return send(res,400,{error:'Invalid record id.'});}
  const config=entities[entity];if(!config)return send(res,404,{error:'Curriculum section not found.'});
  if(req.method==='GET'&&!id){
    const search=clean(url.searchParams.get('q'),120),status=clean(url.searchParams.get('status'),20).toLowerCase(),parent=clean(url.searchParams.get('parent'),120),academicYear=clean(url.searchParams.get('academicYear'),120),page=positiveInt(url.searchParams.get('page'),1,100000),limit=positiveInt(url.searchParams.get('limit'),24,50);
    const key=cacheKey(`${entity}|${search}|${status}|${parent}|${academicYear}|${page}|${limit}`),cached=listCache.get(key);if(cached&&cached.expiresAt>Date.now())return send(res,200,cached.value);
    try{
      const query=buildListSql(entity,search,status,parent,academicYear,page,limit);
      const {rows}=await queryWithLimit(()=>getPool().query(query.sql,query.values));
      const records=rows.map(row=>normalize(entity,row)),total=Number(rows[0]?.total||0),value={records,total,page,limit,pages:Math.max(1,Math.ceil(total/limit))};
      const expiresAt=Date.now()+cacheMs;for(const [cacheKey,item] of listCache)if(item.expiresAt<=Date.now())listCache.delete(cacheKey);listCache.set(key,{value,expiresAt});if(listCache.size>200)listCache.delete(listCache.keys().next().value);return send(res,200,value);
    }catch(error){safeLog(endpoint,'list records',error);return send(res,200,{records:[],total:0,page,limit,pages:1,schemaPending:true});}
  }
  if(id&&req.method==='GET'){
    try{const {rows}=await getPool().query(`select * from public.${config.table} where id=$1`,[id]);if(!rows[0])return send(res,404,{error:'Record not found.'});return send(res,200,{record:normalize(entity,rows[0])});}catch(error){safeLog(endpoint,'read record',error);return send(res,200,{record:null,schemaPending:true});}
  }
  if(['POST','PATCH'].includes(req.method)&&((req.method==='POST'&&!id)||(req.method==='PATCH'&&id))){
    let client;
    try{
      client=await getPool().connect();await client.query('begin');
      let current={};if(id){const found=await client.query(`select * from public.${config.table} where id=$1 for update`,[id]);if(!found.rows[0]){await client.query('rollback');return send(res,404,{error:'Record not found.'});}current=normalize(entity,found.rows[0]);}
      const value=cleanInput(entity,input,current);const invalid=await validateParent(client,entity,value);if(invalid){await client.query('rollback');return send(res,400,{error:invalid});}
      const duplicateSql=`select 1 from public.${config.table} where lower(name)=lower($1) and id<>$2 ${entity==='subjects'?"and coalesce(course_id,'')=coalesce(nullif($3,''),'')":entity==='topics'?"and coalesce(subject_id,'')=coalesce(nullif($3,''),'')":entity==='batches'?"and course_id=$3 and coalesce(record_json->>'academicYearId','')=$4":''} limit 1`;
      const duplicateValues=entity==='subjects'?[value.name,id||'',value.courseId||'']:entity==='topics'?[value.name,id||'',value.subjectId||'']:entity==='batches'?[value.name,id||'',value.courseId||'',value.academicYearId||'']:[value.name,id||''];
      const duplicate=await client.query(duplicateSql,duplicateValues);
      if(duplicate.rowCount){await client.query('rollback');return send(res,409,{error:'A record with this name already exists.'});}
      const recordId=id||crypto.randomUUID();const record=await upsert(client,entity,recordId,value);
      if(entity==='courses'){
        await client.query(`update public.batches set course_name=$2,record_json=jsonb_set(jsonb_set(coalesce(record_json,'{}'::jsonb),'{courseName}',to_jsonb($2::text),true),'{course}',to_jsonb($2::text),true),updated_at=now() where course_id=$1`,[recordId,record.name]);
        await client.query(`update public.app_records ar set record_json=b.record_json,updated_at=now() from public.batches b where ar.source_tab='Batches' and ar.record_id=b.id and b.course_id=$1`,[recordId]);
      }
      await client.query('commit');invalidate();return send(res,id?200:201,{record:normalize(entity,{...record,...(entity==='academic-years'?{start_date:record.startDate,end_date:record.endDate}:entity==='subjects'?{course_id:record.courseId}:entity==='topics'?{subject_id:record.subjectId}:entity==='batches'?{course_id:record.courseId,course_name:record.courseName,active:record.active}:{}),record_json:record})});
    }catch(error){if(client)await client.query('rollback').catch(()=>{});if(error.statusCode)return send(res,error.statusCode,{error:error.message});safeLog(endpoint,'save record',error);return send(res,500,{error:'Curriculum record could not be saved.'});}finally{client?.release();}
  }
  return send(res,405,{error:'Method not allowed.'});
}

module.exports={handleCurriculumRoute,buildListSql,entities,statsSql,lookupQueries};
