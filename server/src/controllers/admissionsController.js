const crypto = require('node:crypto');
const multer = require('multer');
const { z } = require('zod');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getPhotoUrl, getPhotoUrls, uploadAdmissionPhoto, copyAdmissionPhotoToStudent, deleteStoredPhoto } = require('../services/photoStorage');
const { webpUnderLimit } = require('../routes/photos');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { createStudentFromAdmission, invalidateStudentCaches } = require('./studentController');
const { body, json } = require('../middleware/http');
const { admissionsListSql, admissionsStatsSql, admissionsBatchesSql, admissionsConfigSql, buildAdmissionsListQuery } = require('../services/admissionsQueries');

const STATUS_VALUES = ['Pending', 'Under Review', 'Approved', 'Rejected'];
const admissionParams = z.object({ applicationNo: z.string().regex(/^APP-[0-9]{4}-[0-9]{5}$/) });
const receivePhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 }, fileFilter: (_req, file, callback) => {
  callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
} }).single('photo');
const statsCache = { expiresAt: 0, value: null };
const lookupsCache = { expiresAt: 0, value: null };
const requests = new Map();
const clean = (value, max=500) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0,max);
const safeLog = (endpoint, step, error) => {
  const code=String(error?.code||'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40);
  const message=String(error?.message||'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi,'[redacted]').replace(/\b(password|hash|cookie|authorization|database_url)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]').slice(0,400);
  console.error(`[admissions] endpoint=${endpoint} step=${step} failed (code=${code}): ${message}`);
};
const invalidateCaches=()=>{statsCache.expiresAt=0;statsCache.value=null;lookupsCache.expiresAt=0;lookupsCache.value=null;};
const response=(res,status,data)=>json(res,status,data);
const defaultAcademicYear=()=>{const year=new Date().getFullYear();return `${year}-${year+1}`;};
const parseConfig=row=>({open:(row?.config?.admissionsOpen??row?.config?.open)!==false,instituteName:row?.institute_name||'My JEE Mentor',academicYear:row?.academic_year||row?.record_json?.academicYear||defaultAcademicYear()});

function requestAllowed(map,key,max,windowMs) {
  const now=Date.now(),recent=(map.get(key)||[]).filter(stamp=>stamp>now-windowMs);
  if(recent.length>=max){map.set(key,recent);return false;}
  recent.push(now);map.set(key,recent);return true;
}
function ipOf(req){return String(req.socket?.remoteAddress||'local').slice(0,80);}
function safeDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date.toISOString().slice(0,10);}
function validDate(value){return !value||(/^\d{4}-\d{2}-\d{2}$/.test(value)&&safeDate(value)===value);}
function statusEvent(record,status,reason='') { return [...(Array.isArray(record.statusHistory)?record.statusHistory:[]),{status,at:new Date().toISOString(),reason}]; }
function publicApplication(row,photoUrl=null) {
  const source=row.record_json&&typeof row.record_json==='object'?row.record_json:{};
  const result={...source,id:row.application_no,applicationNo:row.application_no,name:row.name,email:row.email,mobile:row.mobile,gender:row.gender||'',dateOfBirth:row.date_of_birth||'',batchId:row.batch_id||'',batchName:row.batch_name||'',address:row.address||'',fatherName:row.father_name||'',motherName:row.mother_name||'',guardianPhone:row.guardian_phone||'',previousSchool:row.previous_school||'',previousYearPercent:row.previous_year_percent==null?'':Number(row.previous_year_percent),declarationAcceptedAt:row.declaration_accepted_at,appliedAt:row.applied_at,status:row.status,adminNotes:row.admin_notes||'',rejectReason:row.reject_reason||'',statusHistory:Array.isArray(row.status_history)?row.status_history:[],studentId:row.student_id||source.student?.id||null};
  delete result.photoData;delete result.photoFile;delete result.photo;delete result.photoPath;delete result.photo_path;
  if(photoUrl)result.photo=photoUrl;
  return result;
}
async function getConfigRow() {
  const {rows}=await getPool().query(admissionsConfigSql);
  return rows[0]||null;
}
async function runUpload(req,res) {
  await new Promise((resolve,reject)=>receivePhoto(req,res,error=>error?reject(error):resolve()));
}
async function adminAccount(req) {
  const session=getSession(req);
  if(!session)return {status:401,error:'Sign in required.'};
  const account=await resolveSessionAccount(req);
  if(!account)return {status:401,error:'Sign in required.'};
  if(account.role!=='admin')return {status:403,error:'Administrator access is required.'};
  return {session,account};
}
async function handlePublic(req,res,url) {
  if(req.method==='GET'&&url.pathname==='/api/admissions/public/config') {
    try{return response(res,200,{...parseConfig(await getConfigRow())});}
    catch(error){safeLog('/api/admissions/public/config','load config',error);return response(res,200,{open:true,instituteName:'My JEE Mentor',academicYear:defaultAcademicYear(),schemaPending:true});}
  }
  if(req.method==='GET'&&url.pathname==='/api/admissions/public/batches') {
    try{const {rows}=await queryWithLimit(()=>getPool().query(admissionsBatchesSql));return response(res,200,rows.map(row=>({id:row.id,name:row.name,course:row.course||''})));}
    catch(error){safeLog('/api/admissions/public/batches','load batches',error);return response(res,200,[]);}
  }
  const photoMatch=url.pathname.match(/^\/api\/admissions\/public\/([^/]+)\/photo$/);
  if(photoMatch&&req.method==='POST') {
    let applicationNo;
    try{applicationNo=decodeURIComponent(photoMatch[1]);}catch{return response(res,400,{error:'Invalid application number.'});}
    if(!admissionParams.safeParse({applicationNo}).success)return response(res,400,{error:'Invalid application number.'});
    if(!requestAllowed(requests,`photo:${ipOf(req)}`,8,10*60*1000))return response(res,429,{error:'Too many photo uploads. Try again later.'});
    try{
      await runUpload(req,res);
      if(!req.file)return response(res,415,{error:'Upload one JPEG, PNG, or WebP photo.'});
      const processed=await webpUnderLimit(req.file.buffer);
      const path=await uploadAdmissionPhoto(applicationNo,processed);
      const client=await getPool().connect();
      try{
        await client.query('begin');
        const found=await client.query("select record_json,status from public.admissions where application_no=$1 for update",[applicationNo]);
        if(!found.rowCount||found.rows[0].status!=='Pending'){await client.query('rollback');await deleteStoredPhoto(path);return response(res,404,{error:'Pending application was not found.'});}
        const updated={...found.rows[0].record_json,photoPath:path};
        await client.query('update public.admissions set photo_path=$2,record_json=$3::jsonb,updated_at=now() where application_no=$1',[applicationNo,path,JSON.stringify(updated)]);
        await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Admissions',applicationNo,JSON.stringify(updated)]);
        await client.query('commit');
        return response(res,200,{ok:true});
      }catch(error){await client.query('rollback');await deleteStoredPhoto(path).catch(()=>{});throw error;}finally{client.release();}
    }catch(error){safeLog('/api/admissions/public/:applicationNo/photo','upload photo',error);return response(res,Number(error.statusCode)||500,{error:error.statusCode?error.message:'Admission photo could not be saved.'});}
  }
  if(req.method==='POST'&&url.pathname==='/api/admissions/submit') {
    if(!requestAllowed(requests,`submit:${ipOf(req)}`,5,10*60*1000))return response(res,429,{error:'Too many applications from this connection. Please try again later.'});
    let input;try{input=await body(req,256*1024);}catch{return response(res,400,{error:'Invalid application request.'});}
    const name=clean(input.name,160),gender=clean(input.gender,20),dateOfBirth=clean(input.dateOfBirth,10),batchId=clean(input.batchId,120),mobile=String(input.mobile||'').replace(/\D/g,'').slice(0,10),email=clean(input.email,254).toLowerCase(),address=clean(input.address,1000),fatherName=clean(input.fatherName,160),motherName=clean(input.motherName,160),guardianPhone=String(input.guardianPhone||'').replace(/\D/g,'').slice(0,10),previousSchool=clean(input.previousSchool,200),percentRaw=input.previousYearPercent;
    const percent=percentRaw===''||percentRaw==null?null:Number(percentRaw);
    if(name.length<2||!['Male','Female','Other'].includes(gender)||!batchId||!/^\d{10}$/.test(mobile)||!/^\S+@\S+\.\S+$/.test(email)||!validDate(dateOfBirth)||(guardianPhone&&!/^\d{10}$/.test(guardianPhone))||input.declaration!==true||percent!==null&&(!Number.isFinite(percent)||percent<0||percent>100))return response(res,400,{error:'Check the required fields and try again.'});
    const client=await getPool().connect();
    try{
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('admission-application-number'))");
      const settings=await client.query(admissionsConfigSql);
      const config=parseConfig(settings.rows[0]);
      if(!config.open){await client.query('rollback');return response(res,403,{error:'Admissions are currently closed.'});}
      const batch=await client.query("select b.id,b.name,coalesce(b.course_name,c.name,'') course from public.batches b left join public.courses c on c.id=b.course_id where b.id=$1 and coalesce(b.active,true)=true limit 1",[batchId]);
      if(!batch.rowCount){await client.query('rollback');return response(res,400,{error:'Select an active course and batch.'});}
      const duplicate=await client.query("select 1 from public.admissions where mobile=$1 and batch_id=$2 and status in ('Pending','Under Review','Approved') limit 1",[mobile,batchId]);
      if(duplicate.rowCount){await client.query('rollback');return response(res,409,{error:'An application for this mobile number and batch is already being processed.'});}
      const year=String(config.academicYear).match(/\d{4}/)?.[0]||String(new Date().getFullYear());
      const previous=await client.query('select application_no from public.admissions where application_no like $1 order by application_no desc limit 1',[`APP-${year}-%`]);
      const lastNumber=Number(previous.rows[0]?.application_no?.match(/^APP-\d{4}-(\d{5})$/)?.[1]||0)+1;
      const applicationNo=`APP-${year}-${String(lastNumber).padStart(5,'0')}`,appliedAt=new Date().toISOString();
      const batchName=`${batch.rows[0].course?`${batch.rows[0].course} - `:''}${batch.rows[0].name}`;
      const record={id:applicationNo,_type:'application',applicationNo,appliedAt,status:'Pending',name,gender,dateOfBirth,batchId,batchName,mobile,email,address,fatherName,motherName,guardianPhone,previousSchool,previousYearPercent:percent??'',declarationAcceptedAt:appliedAt,adminNotes:'',rejectReason:'',statusHistory:[{status:'Pending',at:appliedAt,reason:''}]};
      await client.query(`insert into public.admissions(application_no,name,gender,date_of_birth,batch_id,batch_name,mobile,email,address,father_name,mother_name,guardian_phone,previous_school,previous_year_percent,declaration_accepted_at,status,applied_at,admin_notes,reject_reason,status_history,record_json)
        values($1,$2,$3,nullif($4,'')::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'','',$18::jsonb,$19::jsonb)`,[applicationNo,name,gender,dateOfBirth,batchId,batchName,mobile,email,address,fatherName,motherName,guardianPhone||null,previousSchool,percent,appliedAt,'Pending',appliedAt,JSON.stringify(record.statusHistory),JSON.stringify(record)]);
      await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)',['Admissions',applicationNo,JSON.stringify(record)]);
      await client.query('commit');
      return response(res,201,{ok:true,applicationNo,mobile,email});
    }catch(error){await client.query('rollback').catch(()=>{});safeLog('/api/admissions/submit','save application',error);return response(res,500,{error:'Could not save the application. Please try again.'});}
    finally{client.release();}
  }
  return false;
}

async function handleAdmin(req,res,url) {
  const endpoint=url.pathname;
  let auth;try{auth=await adminAccount(req);}catch(error){safeLog(endpoint,'verify administrator',error);return response(res,500,{error:'Administrator session could not be verified.'});}
  if(auth.status)return response(res,auth.status,{error:auth.error});
  const {account,session}=auth;
  let input={};
  if(['POST','PATCH','PUT'].includes(req.method)){if(!validCsrfRequest(req,session))return response(res,403,{error:'CSRF validation failed.'});try{input=await body(req,128*1024);}catch{return response(res,400,{error:'Invalid request body.'});}}
  if(req.method==='GET'&&endpoint==='/api/admin/admissions') {
    const search=clean(url.searchParams.get('q'),120),status=clean(url.searchParams.get('status'),30),batchId=clean(url.searchParams.get('batch'),120);
    if(status&&!STATUS_VALUES.includes(status))return response(res,400,{error:'Choose a valid application status.'});
    const page=Math.max(1,Number(url.searchParams.get('page'))||1),limit=Math.min(50,Math.max(1,Number(url.searchParams.get('limit'))||10));
    try{
      const query=buildAdmissionsListQuery(search,status,batchId,page,limit),result=await queryWithLimit(()=>getPool().query(query.sql,query.values));
      const records=Array.isArray(result.rows[0]?.records)?result.rows[0].records:[],urls=await getPhotoUrls(records.map(row=>({path:row.photo_path,updatedAt:row.updated_at}))).catch(error=>{safeLog(endpoint,'sign applicant photos',error);return records.map(()=>null)});
      const applications=records.map((row,index)=>publicApplication(row,urls[index]));
      return response(res,200,{applications,total:Number(result.rows[0]?.total||0),page,limit,pages:Math.max(1,Math.ceil(Number(result.rows[0]?.total||0)/limit))});
    }catch(error){safeLog(endpoint,'list applications',error);return response(res,200,{applications:[],total:0,page,limit,pages:1,schemaPending:true});}
  }
  if(req.method==='GET'&&endpoint==='/api/admin/admissions/stats') {
    if(statsCache.value&&statsCache.expiresAt>Date.now())return response(res,200,statsCache.value);
    try{const {rows}=await queryWithLimit(()=>getPool().query(admissionsStatsSql)),row=rows[0]||{},value={total:Number(row.total||0),pending:Number(row.pending||0),underReview:Number(row.under_review||0),approved:Number(row.approved||0),rejected:Number(row.rejected||0)};statsCache.value=value;statsCache.expiresAt=Date.now()+15000;return response(res,200,value);}
    catch(error){safeLog(endpoint,'load stats',error);return response(res,200,{total:0,pending:0,underReview:0,approved:0,rejected:0,schemaPending:true});}
  }
  if(req.method==='GET'&&endpoint==='/api/admin/admissions/lookups') {
    if(lookupsCache.value&&lookupsCache.expiresAt>Date.now())return response(res,200,lookupsCache.value);
    const result={batches:[],config:{open:true,instituteName:'My JEE Mentor',academicYear:defaultAcademicYear()},schemaPending:false};
    const tasks=[['batches',()=>getPool().query(admissionsBatchesSql)],['config',()=>getConfigRow()]];
    await Promise.all(tasks.map(([key,task])=>queryWithLimit(task).then(value=>{if(key==='batches')result.batches=value.rows.map(row=>({id:row.id,name:row.name,course:row.course||''}));else result.config=parseConfig(value);}).catch(error=>{safeLog(endpoint,`load ${key}`,error);result.schemaPending=true;})));
    lookupsCache.value=result;lookupsCache.expiresAt=Date.now()+15000;return response(res,200,result);
  }
  if(req.method==='PATCH'&&endpoint==='/api/admin/admissions/settings') {
    if(typeof input.open!=='boolean')return response(res,400,{error:'Choose whether admissions are open.'});
    try{
      const current=await getConfigRow(),next={...(current?.config||{}),open:input.open,admissionsOpen:input.open},config=parseConfig({...current,config:next});
      await getPool().query(`insert into public.institute_settings(id,institute_name,academic_year,config,record_json)
        values('institute-settings',$1,$2,$3::jsonb,$4::jsonb)
        on conflict(id) do update set institute_name=coalesce(excluded.institute_name,institute_settings.institute_name),academic_year=coalesce(excluded.academic_year,institute_settings.academic_year),config=coalesce(institute_settings.config,'{}'::jsonb)||excluded.config,record_json=institute_settings.record_json||excluded.record_json,updated_at=now()`,[config.instituteName,config.academicYear,JSON.stringify(next),JSON.stringify({id:'institute-settings',instituteName:config.instituteName,academicYear:config.academicYear,config:next})]);
      invalidateCaches();return response(res,200,{ok:true,config:{...config,open:input.open}});
    }catch(error){safeLog(endpoint,'save settings',error);return response(res,500,{error:'Admission settings could not be saved.'});}
  }
  const match=endpoint.match(/^\/api\/admin\/admissions\/([^/]+)$/);
  if(match&&['GET','PATCH'].includes(req.method)) {
    let applicationNo;try{applicationNo=decodeURIComponent(match[1]);}catch{return response(res,400,{error:'Invalid application number.'});}
    if(!admissionParams.safeParse({applicationNo}).success)return response(res,400,{error:'Invalid application number.'});
    if(req.method==='GET'){
      try{const {rows}=await getPool().query('select * from public.admissions where application_no=$1',[applicationNo]);if(!rows[0])return response(res,404,{error:'Application not found.'});const photo=rows[0].photo_path?await getPhotoUrl(rows[0].photo_path,rows[0].updated_at).catch(error=>{safeLog(endpoint,'sign applicant photo',error);return null;}):null;return response(res,200,{application:publicApplication(rows[0],photo)});}
      catch(error){safeLog(endpoint,'read application',error);return response(res,200,{application:null,schemaPending:true});}
    }
    const status=input.status===undefined?undefined:clean(input.status,30),adminNotes=input.adminNotes===undefined?undefined:clean(input.adminNotes,4000),rejectReason=input.rejectReason===undefined?undefined:clean(input.rejectReason,1000);
    if(status!==undefined&&(!STATUS_VALUES.includes(status)||status==='Approved'))return response(res,400,{error:'Use the approval action to approve an application.'});
    if(status==='Rejected'&&!rejectReason)return response(res,400,{error:'A rejection reason is required.'});
    try{
      const client=await getPool().connect();let updated;
      try{await client.query('begin');const found=await client.query('select * from public.admissions where application_no=$1 for update',[applicationNo]);if(!found.rows[0]){await client.query('rollback');return response(res,404,{error:'Application not found.'});}const row=found.rows[0],record=row.record_json||{};if(row.status==='Approved'){await client.query('rollback');return response(res,409,{error:'An approved application cannot be changed.'});}
        const nextStatus=status??row.status,nextNotes=adminNotes??row.admin_notes??'',nextReject=nextStatus==='Rejected'?(rejectReason??row.reject_reason??''):row.reject_reason??'';
        const history=status&&status!==row.status?statusEvent(record,status,nextReject):Array.isArray(row.status_history)?row.status_history:[];
        updated={...record,status:nextStatus,adminNotes:nextNotes,rejectReason:nextReject,statusHistory:history};
        await client.query('update public.admissions set status=$2,admin_notes=$3,reject_reason=$4,status_history=$5::jsonb,record_json=$6::jsonb,updated_at=now() where application_no=$1',[applicationNo,nextStatus,nextNotes,nextReject,JSON.stringify(history),JSON.stringify(updated)]);
        await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Admissions',applicationNo,JSON.stringify(updated)]);await client.query('commit');
      }catch(error){await client.query('rollback').catch(()=>{});throw error;}finally{client.release();}
      invalidateCaches();return response(res,200,{ok:true,application:{...updated,id:applicationNo,applicationNo}});
    }catch(error){safeLog(endpoint,'update application',error);return response(res,500,{error:'Application could not be updated.'});}
  }
  const approveMatch=endpoint.match(/^\/api\/admin\/admissions\/([^/]+)\/approve$/);
  if(approveMatch&&req.method==='POST') {
    let applicationNo;try{applicationNo=decodeURIComponent(approveMatch[1]);}catch{return response(res,400,{error:'Invalid application number.'});}
    if(!admissionParams.safeParse({applicationNo}).success)return response(res,400,{error:'Invalid application number.'});
    const requestedLink=clean(input.linkExistingStudentId,120);let copiedPath=null;
    const client=await getPool().connect();
    try{
      await client.query('begin');
      const found=await client.query('select * from public.admissions where application_no=$1 for update',[applicationNo]);
      if(!found.rows[0]){await client.query('rollback');return response(res,404,{error:'Application not found.'});}
      const row=found.rows[0],record=row.record_json||{};
      if(row.status==='Approved'){await client.query('rollback');return response(res,200,{ok:true,unchanged:true,studentId:row.student_id||record.student?.id||null});}
      if(!['Pending','Under Review'].includes(row.status)){await client.query('rollback');return response(res,409,{error:'Reopen this application before approving it.'});}
      const matches=await client.query(`select id,name,email from public.students where lower(email)=lower($1) or regexp_replace(coalesce(phone,''),'[^0-9]','','g')=$2 order by id limit 3`,[row.email,row.mobile]);
      let studentId,studentName;
      if(matches.rowCount){
        if(requestedLink){const existing=matches.rows.find(item=>item.id===requestedLink);if(!existing){await client.query('rollback');return response(res,400,{error:'Choose a matching existing student.'});}studentId=existing.id;studentName=existing.name;}
        else if(matches.rowCount===1){studentId=matches.rows[0].id;studentName=matches.rows[0].name;}
        else{await client.query('rollback');return response(res,409,{error:'More than one student matches this application. Resolve the duplicate records before approval.',existingStudents:matches.rows.map(item=>({id:item.id,name:item.name,email:item.email}))});}
      }else if(requestedLink){await client.query('rollback');return response(res,404,{error:'The selected existing student could not be found.'});}
      else{
        const student=await createStudentFromAdmission(client,{applicationNo:row.application_no,name:row.name,email:row.email,mobile:row.mobile,batchId:row.batch_id,gender:row.gender,dateOfBirth:row.date_of_birth?new Date(row.date_of_birth).toISOString().slice(0,10):'',address:row.address,fatherName:row.father_name,motherName:row.mother_name,guardianPhone:row.guardian_phone},account.email);
        studentId=student.id;studentName=student.name;
        if(row.photo_path){copiedPath=await copyAdmissionPhotoToStudent(row.photo_path,studentId);const photoUpdatedAt=new Date().toISOString(),photoRecord={...student,photoPath:copiedPath,photoUpdatedAt};await client.query('update public.students set photo_path=$2,photo_updated_at=$3,record_json=$4::jsonb where id=$1',[studentId,copiedPath,photoUpdatedAt,JSON.stringify(photoRecord)]);await client.query('update public.app_records set record_json=$3::jsonb where source_tab=$1 and record_id=$2',['Students',studentId,JSON.stringify({_type:'app-data',collection:'student',...photoRecord})]);}
      }
      const history=statusEvent(record,'Approved',''),student={id:studentId,name:studentName};
      const adminNotes=clean(input.adminNotes??row.admin_notes??'',4000);
      const updated={...record,status:'Approved',student,studentId,adminNotes,statusHistory:history};
      await client.query("update public.admissions set status='Approved',student_id=$2,admin_notes=$3,status_history=$4::jsonb,record_json=$5::jsonb,updated_at=now() where application_no=$1",[applicationNo,studentId,adminNotes,JSON.stringify(history),JSON.stringify(updated)]);
      await client.query('update public.app_records set record_json=$3::jsonb,updated_at=now() where source_tab=$1 and record_id=$2',['Admissions',applicationNo,JSON.stringify(updated)]);
      await client.query('commit');invalidateCaches();invalidateStudentCaches();return response(res,200,{ok:true,application:{...updated,id:applicationNo,applicationNo},student:{id:studentId,name:studentName}});
    }catch(error){await client.query('rollback').catch(()=>{});if(copiedPath)await deleteStoredPhoto(copiedPath).catch(()=>{});if(error.statusCode)return response(res,error.statusCode,{error:error.message});safeLog(endpoint,'approve application',error);return response(res,500,{error:'Application could not be approved.'});}
    finally{client.release();}
  }
  return response(res,404,{error:'Admissions route not found.'});
}

async function handleAdmissionsRoute(req,res,url) {
  if(url.pathname==='/api/admin/admissions'||url.pathname.startsWith('/api/admin/admissions/'))return handleAdmin(req,res,url);
  if(url.pathname.startsWith('/api/admissions/admin/')){
    const mapped={...url,pathname:url.pathname.replace('/api/admissions/admin','/api/admin/admissions')};
    return handleAdmin(req,res,mapped);
  }
  if(url.pathname.startsWith('/api/admissions/'))return handlePublic(req,res,url);
  return false;
}

module.exports={handleAdmissionsRoute,invalidateCaches,admissionsListSql,admissionsStatsSql,admissionsBatchesSql,admissionsConfigSql};
