const crypto = require('node:crypto');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');

const cacheMs = 12000;
const cache = new Map();
const cacheGet = key => { const entry=cache.get(key); if(entry?.expiresAt>Date.now()) return entry.value; cache.delete(key); return null; };
function invalidate(){cache.clear();}
function safeLog(endpoint,step,error){
  const code=String(error?.code||'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g,'').slice(0,40);
  const message=String(error?.message||'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi,'[redacted]').replace(/\b(password|hash|cookie|authorization|database_url)\b\s*[:=]\s*[^\s,;]+/gi,'$1=[REDACTED]').slice(0,350);
  console.error(`[academics] endpoint=${endpoint} step=${step} failed (code=${code}): ${message}`);
}
const clean=(value,max=240)=>String(value??'').replace(/[<>\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
const pageNumber=value=>{const n=Number(value);return Number.isInteger(n)&&n>0?Math.min(n,100000):1;};
const id=()=>crypto.randomUUID();
const send=(res,status,value)=>json(res,status,value);
const lookupSql=`select
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'courseId',course_id) order by name,id) from public.batches where coalesce(active,true)=true),'[]'::jsonb) batches,
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'courseId',course_id) order by name,id) from public.subjects where lower(coalesce(status,'active')) not in ('inactive','archived')),'[]'::jsonb) subjects,
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'batchId',batch_id,'studentId',student_id) order by name,id) from public.students where lower(coalesce(status,'active')) not in ('inactive','archived')),'[]'::jsonb) students,
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'staffKey',staff_key,'name',name,'staffType',staff_type) order by name,id) from public.staff where lower(coalesce(status,'active')) not in ('inactive','archived')),'[]'::jsonb) staff`;
const statsSql=`select
  (select count(*)::int from public.assignments) homework_total,
  (select count(*)::int from public.assignments where lower(coalesce(status,'')) in ('assigned','active','review','pending')) homework_active,
  (select count(*)::int from public.assignment_submissions where lower(coalesce(status,'')) in ('submitted','review','pending')) homework_pending,
  (select count(*)::int from public.app_records where source_tab='Doubts') doubts_total,
  (select count(*)::int from public.app_records where source_tab='Doubts' and lower(coalesce(record_json->>'status','open')) not in ('resolved','closed')) doubts_open`;

async function authenticate(req){
  if(!getSession(req)) return {status:401,error:'Sign in required.'};
  const account=await resolveSessionAccount(req);
  if(!account)return {status:401,error:'Sign in required.'};
  if(account.role!=='admin')return {status:403,error:'Administrator access is required.'};
  return {account,session:getSession(req)};
}
function pageParams(url){return {page:pageNumber(url.searchParams.get('page')),limit:Math.min(pageNumber(url.searchParams.get('limit')||24),50),q:clean(url.searchParams.get('q'),120),status:clean(url.searchParams.get('status'),30).toLowerCase()};}
function listSql(kind,{page,limit,q,status}){
  const vals=[],where=[];const bind=v=>{vals.push(v);return `$${vals.length}`;};
  if(q){const p=bind(`%${q.toLowerCase()}%`);where.push(kind==='homework'?`(lower(a.title) like ${p} or lower(coalesce(a.record_json->>'subject','')) like ${p} or lower(coalesce(b.name,'')) like ${p})`:`(lower(coalesce(ar.record_json->>'title','')) like ${p} or lower(coalesce(ar.record_json->>'question','')) like ${p} or lower(coalesce(ar.record_json->>'studentName','')) like ${p})`);}
  if(status)where.push(kind==='homework'?`lower(coalesce(a.status,'assigned'))=${bind(status)}`:`lower(coalesce(ar.record_json->>'status','open'))=${bind(status)}`);
  const clause=where.length?`where ${where.join(' and ')}`:''; const offset=(page-1)*limit;
  const sql=kind==='homework'
    ? `select a.id,a.title,a.batch_id,a.due_date,a.status,a.record_json,a.created_at,b.name batch_name,count(*) over()::int total from public.assignments a left join public.batches b on b.id=a.batch_id ${clause} order by a.created_at desc,a.id limit $${vals.length+1} offset $${vals.length+2}`
    : `select ar.record_id,ar.record_json,ar.created_at,count(*) over()::int total from public.app_records ar ${clause} order by ar.created_at desc,ar.record_id limit $${vals.length+1} offset $${vals.length+2}`;
  return {sql,values:[...vals,limit,offset]};
}
function normalizeHomework(row){const x=row.record_json||{};return {...x,id:row.id,title:row.title||x.title||'',batchId:row.batch_id||x.batchId||'',batchName:row.batch_name||'',subjectId:x.subjectId||'',subject:x.subject||'',dueDate:row.due_date?String(row.due_date).slice(0,10):x.dueDate||'',status:row.status||x.status||'Assigned',description:x.description||'',studentKey:x.studentKey||'',staffKey:x.staffKey||'',createdAt:row.created_at||null};}
function normalizeDoubt(row){return {...(row.record_json||{}),id:row.record_id,status:row.record_json?.status||'Open',createdAt:row.created_at||null};}
async function handleAcademicsRoute(req,res,url){
  const endpoint=url.pathname;let auth;
  try{auth=await authenticate(req);}catch(error){safeLog(endpoint,'verify administrator',error);return send(res,500,{error:'Administrator session could not be verified.'});}
  if(auth.status)return send(res,auth.status,{error:auth.error});
  if(['POST','PATCH'].includes(req.method)&&!validCsrfRequest(req,auth.session))return send(res,403,{error:'CSRF validation failed.'});
  let input={};if(['POST','PATCH'].includes(req.method)){try{input=await body(req,64*1024);}catch{return send(res,400,{error:'Invalid request body.'});}}
  if(req.method==='GET'&&endpoint==='/api/admin/academics/lookups'){
    const cached=cacheGet('lookups');if(cached)return send(res,200,cached);
    try{const {rows}=await queryWithLimit(()=>getPool().query(lookupSql));const value={...(rows[0]||{}),batches:rows[0]?.batches||[],subjects:rows[0]?.subjects||[],students:rows[0]?.students||[],staff:rows[0]?.staff||[],schemaPending:false};cache.set('lookups',{value,expiresAt:Date.now()+cacheMs});return send(res,200,value);}
    catch(error){safeLog(endpoint,'load lookups',error);return send(res,200,{batches:[],subjects:[],students:[],staff:[],schemaPending:true});}
  }
  if(req.method==='GET'&&endpoint==='/api/admin/academics/stats'){
    const cached=cacheGet('stats');if(cached)return send(res,200,cached);
    try{const {rows}=await queryWithLimit(()=>getPool().query(statsSql));const value=rows[0]||{homework_total:0,homework_active:0,homework_pending:0,doubts_total:0,doubts_open:0};cache.set('stats',{value,expiresAt:Date.now()+cacheMs});return send(res,200,value);}
    catch(error){safeLog(endpoint,'load stats',error);return send(res,200,{homework_total:0,homework_active:0,homework_pending:0,doubts_total:0,doubts_open:0,schemaPending:true});}
  }
  const match=endpoint.match(/^\/api\/admin\/academics\/(homework|doubts)(?:\/([^/]+))?$/);
  if(!match)return send(res,404,{error:'Academics route not found.'});
  const kind=match[1],recordId=match[2]?clean(decodeURIComponent(match[2]),160):'';
  if(req.method==='GET'&&!recordId){
    const params=pageParams(url),key=`${kind}|${params.page}|${params.limit}|${params.q}|${params.status}`,cached=cacheGet(key);if(cached)return send(res,200,cached);
    try{const query=listSql(kind,params);const {rows}=await queryWithLimit(()=>getPool().query(query.sql,query.values));const records=rows.map(kind==='homework'?normalizeHomework:normalizeDoubt),total=Number(rows[0]?.total||0),value={records,total,page:params.page,limit:params.limit,pages:Math.max(1,Math.ceil(total/params.limit)),schemaPending:false};cache.set(key,{value,expiresAt:Date.now()+cacheMs});return send(res,200,value);}
    catch(error){safeLog(endpoint,`list ${kind}`,error);return send(res,200,{records:[],total:0,page:params.page,limit:params.limit,pages:1,schemaPending:true});}
  }
  if(kind==='homework'&&req.method==='POST'&&!recordId){
    const title=clean(input.title,180),batchId=clean(input.batchId,120),subjectId=clean(input.subjectId,120),dueDate=clean(input.dueDate,10),description=clean(input.description,4000),studentKey=clean(input.studentKey,120),staffKey=clean(input.staffKey,120);
    if(!title||!batchId||!subjectId||!/^\d{4}-\d{2}-\d{2}$/.test(dueDate))return send(res,400,{error:'Provide a title, batch, subject, and due date.'});
    try{
      const refs=await queryWithLimit(()=>getPool().query(`select exists(select 1 from public.batches where id=$1 and coalesce(active,true)=true) batch_ok,exists(select 1 from public.subjects su join public.batches ba on ba.id=$1 where su.id=$2 and (su.course_id is null or su.course_id=ba.course_id) and lower(coalesce(su.status,'active')) not in ('inactive','archived')) subject_ok,exists(select 1 from public.students where id=$3 and (batch_id is null or batch_id=$1) and lower(coalesce(status,'active')) not in ('inactive','archived')) student_ok,exists(select 1 from public.staff where staff_key::text=$4 and lower(coalesce(status,'active')) not in ('inactive','archived')) staff_ok`,[batchId,subjectId,studentKey||'__none__',staffKey||'__none__']));
      const check=refs.rows[0]||{};if(!check.batch_ok)return send(res,400,{error:'Choose an active batch first.'});if(!check.subject_ok)return send(res,400,{error:'Choose an active subject.'});if(studentKey&&!check.student_ok)return send(res,400,{error:'Choose an existing student.'});if(staffKey&&!check.staff_ok)return send(res,400,{error:'Choose an active staff member.'});
      const record={id:id(),title,batchId,subjectId,subject:clean(input.subject||input.subjectName,120),dueDate,status:'Assigned',description,studentKey,staffKey,createdBy:auth.account.id,createdAt:new Date().toISOString()};
      const client=await getPool().connect();try{await client.query('begin');await client.query('insert into public.assignments(id,title,batch_id,due_date,status,created_by,record_json) values($1,$2,$3,$4,$5,$6,$7::jsonb)',[record.id,title,batchId,dueDate,record.status,staffKey||auth.account.id,JSON.stringify(record)]);await client.query('commit');}catch(error){await client.query('rollback');throw error;}finally{client.release();}
      invalidate();return send(res,201,{record});
    }catch(error){safeLog(endpoint,'create homework',error);return send(res,500,{error:'Homework could not be saved.'});}
  }
  if(kind==='doubts'&&req.method==='POST'&&!recordId){
    const title=clean(input.title,180),question=clean(input.question,4000),studentKey=clean(input.studentKey,120),staffKey=clean(input.staffKey,120),batchId=clean(input.batchId,120),subjectId=clean(input.subjectId,120);
    if(!title||!question)return send(res,400,{error:'Provide a title and question.'});
    try{
      const refs=await queryWithLimit(()=>getPool().query(`select exists(select 1 from public.students where id=$1) student_ok,exists(select 1 from public.staff where staff_key::text=$2) staff_ok,exists(select 1 from public.batches where id=$3) batch_ok,exists(select 1 from public.subjects where id=$4) subject_ok`,[studentKey||'__none__',staffKey||'__none__',batchId||'__none__',subjectId||'__none__']));const check=refs.rows[0]||{};
      if(studentKey&&!check.student_ok)return send(res,400,{error:'Choose an existing student.'});if(staffKey&&!check.staff_ok)return send(res,400,{error:'Choose an existing staff member.'});if(batchId&&!check.batch_ok)return send(res,400,{error:'Choose an existing batch.'});if(subjectId&&!check.subject_ok)return send(res,400,{error:'Choose an existing subject.'});
      const record={id:id(),title,question,studentKey,staffKey,batchId,subjectId,status:'Open',createdBy:auth.account.id,createdAt:new Date().toISOString()};await queryWithLimit(()=>getPool().query(`insert into public.app_records(source_tab,record_id,record_json) values('Doubts',$1,$2::jsonb)`,[record.id,JSON.stringify(record)]));invalidate();return send(res,201,{record});
    }catch(error){safeLog(endpoint,'create doubt',error);return send(res,500,{error:'Doubt could not be saved.'});}
  }
  if(kind==='doubts'&&req.method==='PATCH'&&recordId){
    const status=clean(input.status,20);if(!['Open','In Progress','Resolved','Closed'].includes(status))return send(res,400,{error:'Choose a valid doubt status.'});
    try{const {rows}=await queryWithLimit(()=>getPool().query(`update public.app_records set record_json=jsonb_set(record_json,'{status}',to_jsonb($2::text),true)||jsonb_build_object('updatedAt',now()),updated_at=now() where source_tab='Doubts' and record_id=$1 returning record_id,record_json,created_at`,[recordId,status]));if(!rows[0])return send(res,404,{error:'Doubt was not found.'});invalidate();return send(res,200,{record:normalizeDoubt(rows[0])});}
    catch(error){safeLog(endpoint,'update doubt',error);return send(res,500,{error:'Doubt status could not be updated.'});}
  }
  return send(res,405,{error:'Method not allowed.'});
}
module.exports={handleAcademicsRoute,listSql,lookupSql,statsSql};
