const crypto = require('node:crypto');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { json } = require('../middleware/http');
const { validCsrfRequest } = require('../middleware/auth');

const cache = new Map();
const CACHE_MS = 12000;
const id = () => crypto.randomUUID();
const amountPattern = /^\d{1,10}(?:\.\d{1,2})?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const allowedMethods = new Set(['cash', 'upi', 'bank transfer', 'card', 'cheque', 'online']);
const clean = (value, limit = 180) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, limit);
const safeNum = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const safeError = error => String(error?.message || 'Unknown error')
  .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
  .replace(/\b(database_url|password|hash|cookie|authorization|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/[\r\n\t]+/g, ' ').slice(0, 300);
function log(endpoint, step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  console.error(`[finance] endpoint=${endpoint} step=${step} code=${code} message=${safeError(error)}`);
}
function invalidate() { cache.clear(); }
async function cached(key, task) {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  const value = await task();
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
}
function fail(res, endpoint, step, error, status = 500) {
  log(endpoint, step, error);
  return json(res, status, { error: 'This finance request could not be completed. Please retry.' });
}
function validAmount(value, allowZero = false) {
  return amountPattern.test(String(value ?? '')) && (allowZero || Number(value) > 0);
}
function validDate(value) { return !value || (datePattern.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))); }
function parseCsv(text) {
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){field+='"';i++;}else if(c==='"')quoted=false;else field+=c;}else if(c==='"'&&field==='')quoted=true;else if(c===','){row.push(field);field='';}else if(c==='\n'){row.push(field);rows.push(row);row=[];field='';}else if(c!=='\r')field+=c;}
  if(quoted)throw new Error('CSV contains an unclosed quoted field.');if(field||row.length){row.push(field);rows.push(row);}return rows.filter(x=>x.some(v=>v.trim()));
}
function isWrite(req, session) { return validCsrfRequest(req, session); }
function admin(actor, res) { return actor?.role === 'admin' ? true : json(res, 403, { error: 'Administrator access is required.' }); }

const SQL = {
  feeList: `with ledger as (
    select f.id, f.student_key, f.batch_id, f.structure_id, f.title, f.fee_type_id, f.total_amount,
      f.due_date, f.status, f.installment_no, f.installment_count, f.created_at,
      coalesce(sum(p.amount) filter (where p.reversed_at is null),0)::numeric paid,
      coalesce(sum(p.discount_amount) filter (where p.reversed_at is null),0)::numeric discounts,
      coalesce(sum(p.fine_amount) filter (where p.reversed_at is null),0)::numeric fines
    from public.student_fees f left join public.fee_payments p on p.student_fee_id=f.id
    group by f.id
  )
  select l.id,l.student_key,l.batch_id,l.structure_id,l.title,l.fee_type_id,l.total_amount,l.due_date,
    l.installment_no,l.installment_count,l.paid,l.discounts,l.fines,l.created_at,
    greatest(l.total_amount-l.paid-l.discounts-l.fines,0)::numeric balance,
    case when greatest(l.total_amount-l.paid-l.discounts-l.fines,0)=0 then 'Paid'
      when l.paid>0 then 'Partial' when l.due_date<current_date then 'Overdue' else 'Upcoming' end computed_status,
    s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number,
    b.name batch_name,b.course_id,c.name course_name,coalesce(s.status,'active') student_status,
    coalesce(ft.name,'Tuition') fee_type, count(*) over()::int total_count
    from ledger l join public.students s on s.id=l.student_key
  left join public.batches b on b.id=l.batch_id left join public.courses c on c.id=b.course_id
  left join public.fee_types ft on ft.id=l.fee_type_id
  where ($1::text='' or s.name ilike '%'||$1||'%' or coalesce(s.roll,s.record_json->>'admissionNumber','') ilike '%'||$1||'%')
    and ($2::text='' or b.course_id=$2) and ($3::text='' or l.batch_id=$3)
    and ($4::text='' or l.student_key=$4) and ($5::text='all' or lower(coalesce(s.status,''))=$5)
    and ($6::text='all' or lower(coalesce(l.fee_type_id,''))=$6)
    and ($7::text='all' or lower(case when greatest(l.total_amount-l.paid-l.discounts-l.fines,0)=0 then 'paid' when l.paid>0 then 'partial' when l.due_date<current_date then 'overdue' else 'upcoming' end)=$7)
    and ($8::date is null or l.due_date >= $8::date) and ($9::date is null or l.due_date <= $9::date)
    and (not $10::boolean or (l.due_date<current_date and greatest(l.total_amount-l.paid-l.discounts-l.fines,0)>0))
  order by l.due_date nulls last,l.created_at desc limit $11 offset $12`,
  feeStats: `select count(*)::int total_billed_count,
    coalesce(sum(f.total_amount),0)::numeric total_billed,
    coalesce(sum(coalesce(p.paid,0)),0)::numeric collected,
    coalesce(sum(greatest(f.total_amount-coalesce(p.paid,0)-coalesce(p.discount,0)-coalesce(p.fine,0),0)),0)::numeric pending,
    coalesce(sum(coalesce(p.discount,0)),0)::numeric discounts_given,
    count(*) filter(where f.due_date<current_date and greatest(f.total_amount-coalesce(p.paid,0)-coalesce(p.discount,0)-coalesce(p.fine,0),0)>0)::int overdue
    from public.student_fees f left join lateral (select sum(amount) filter(where reversed_at is null) paid,
      sum(discount_amount) filter(where reversed_at is null) discount,sum(fine_amount) filter(where reversed_at is null) fine
      from public.fee_payments where student_fee_id=f.id) p on true`,
};

async function route(req, res, url, input, actor, session) {
  const endpoint = url.pathname;
  if (!endpoint.startsWith('/api/admin/finance')) return null;
  if (!admin(actor, res)) return res;
  if (req.method !== 'GET' && !isWrite(req, session)) return json(res, 403, { error: 'A valid CSRF token is required.' });
  const pool = getPool();
  const method = req.method;
  try {
    if (method === 'GET' && endpoint === '/api/admin/finance/lookups') {
      const data = await cached('lookups', async () => {
        const q = (sql, values = []) => queryWithLimit(() => pool.query(sql, values));
        const [students,batches,courses,years,staff,types] = await Promise.all([
          q("select id,student_id,name,roll,batch_id,status from public.students where lower(coalesce(status,'active')) not in ('deleted','withdrawn') order by name limit 5000"),
          q('select id,name,course_id,course_name,active from public.batches where coalesce(active,true) order by name limit 2000'),
          q('select id,name,status from public.courses order by name limit 1000'),
          q('select id,name,start_date,end_date,status from public.academic_years order by start_date desc nulls last limit 100'),
          q("select staff_key,name,employee_id,status from public.staff where lower(coalesce(status,'')) not in ('inactive','left','terminated') order by name limit 2000"),
          q('select id,name,component_group,badge_color,active from public.fee_types where active=true order by name'),
        ]);
        return { students:students.rows, batches:batches.rows, courses:courses.rows, academicYears:years.rows, staff:staff.rows, feeTypes:types.rows };
      });
      return json(res,200,data);
    }
    if (method === 'GET' && endpoint === '/api/admin/finance/fee-types') {
      const result = await pool.query('select id,name,component_group,badge_color,active from public.fee_types where active=true order by name');
      return json(res,200,{items:result.rows});
    }
    if (method === 'POST' && endpoint === '/api/admin/finance/fee-types') {
      const name=clean(input.name,80),componentGroup=clean(input.componentGroup||'Other',80);
      if(name.length<2)return json(res,400,{error:'Enter a fee type name.'});
      const key=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
      if(!key)return json(res,400,{error:'Enter a valid fee type name.'});
      try{const result=await pool.query('insert into public.fee_types(id,name,component_group,badge_color) values($1,$2,$3,$4) returning id,name,component_group,badge_color,active',[key,name,componentGroup,'blue']);invalidate();return json(res,201,{item:result.rows[0]});}
      catch(error){if(error.code==='23505')return json(res,409,{error:'That fee type already exists.'});throw error;}
    }
    if (method === 'GET' && endpoint === '/api/admin/finance/fees/stats') {
      const stats = await cached('fees:stats', async () => (await pool.query(SQL.feeStats)).rows[0] || {});
      return json(res,200,{ stats:{ totalBilled:safeNum(stats.total_billed), collected:safeNum(stats.collected), pending:safeNum(stats.pending), discountsGiven:safeNum(stats.discounts_given), overdue:safeNum(stats.overdue), count:safeNum(stats.total_billed_count), collectionRate:safeNum(stats.total_billed)?Math.round(safeNum(stats.collected)*100/safeNum(stats.total_billed)):0 } });
    }
    if (method === 'GET' && endpoint === '/api/admin/finance/fees') {
      const q = url.searchParams, values = [clean(q.get('search'),120),clean(q.get('courseId'),80),clean(q.get('batchId'),80),clean(q.get('studentKey'),100),clean(q.get('studentType')||'active',30).toLowerCase(),clean(q.get('type')||'all',80).toLowerCase(),clean(q.get('status')||'all',30).toLowerCase(),q.get('startDate')||null,q.get('endDate')||null,q.get('overdue')==='1',Math.min(Math.max(Number(q.get('limit'))||25,1),100),Math.max(Number(q.get('offset'))||0,0)];
      if (!validDate(values[7]) || !validDate(values[8])) return json(res,400,{error:'Enter a valid date range.'});
      const result = await queryWithLimit(() => pool.query(SQL.feeList,values));
      return json(res,200,{items:result.rows.map(row=>({...row,totalAmount:safeNum(row.total_amount),paid:safeNum(row.paid),balance:safeNum(row.balance),discounts:safeNum(row.discounts),fines:safeNum(row.fines)})),page:{limit:values[10],offset:values[11],total:safeNum(result.rows[0]?.total_count)}});
    }
    if (method === 'POST' && endpoint === '/api/admin/finance/import') {
      const csv=String(input.csv??'');if(Buffer.byteLength(csv,'utf8')>2*1024*1024)return json(res,413,{error:'CSV file must be no larger than 2 MB.'});
      let rows;try{rows=parseCsv(csv);}catch(error){return json(res,400,{error:error.message});}
      if(rows.length<2)return json(res,400,{error:'CSV must include its header and at least one payment row.'});
      const headers=rows[0].map(x=>x.trim().toLowerCase()),studentIndex=headers.indexOf('student_id'),admissionIndex=headers.indexOf('admission_number'),amountIndex=headers.indexOf('amount'),dateIndex=headers.indexOf('payment_date');
      if((studentIndex<0&&admissionIndex<0)||amountIndex<0||dateIndex<0)return json(res,400,{error:'Required CSV columns: student_id or admission_number, amount, payment_date.'});
      const parsed=rows.slice(1).map((cells,index)=>({line:index+2,studentId:clean(cells[studentIndex]||'',100),admission:clean(cells[admissionIndex]||'',80),amount:String(cells[amountIndex]||'').trim(),date:String(cells[dateIndex]||'').trim()}));
      const invalid=parsed.filter(row=>(!row.studentId&&!row.admission)||!validAmount(row.amount)||!validDate(row.date)||!row.date).map(row=>({line:row.line,error:'Check the student identifier, amount and YYYY-MM-DD payment date.'}));
      if(invalid.length)return json(res,400,{error:'CSV was not imported. Correct the invalid rows and try again.',rowErrors:invalid});
      const client=await pool.connect();try{await client.query('begin');
        for(const row of parsed){
          const student=await client.query(`select id,batch_id from public.students where ($1<>'' and (id=$1 or student_id=$1)) or ($2<>'' and (roll=$2 or record_json->>'admissionNumber'=$2)) limit 1`,[row.studentId,row.admission]);
          if(!student.rowCount){const error=new Error(`Row ${row.line}: student was not found.`);error.statusCode=400;throw error;}
          const feeId=id(),paymentId=id(),receiptNo=`MJM-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,fee={_type:'app-data',collection:'fee',id:feeId,studentId:student.rows[0].id,batchId:student.rows[0].batch_id||'',description:'Imported Fee Payment',amount:Number(row.amount),dueDate:row.date,status:'paid'};
          await client.query(`insert into public.student_fees(id,student_key,batch_id,title,total_amount,due_date,status) values($1,$2,$3,$4,$5,$6,'paid')`,[feeId,student.rows[0].id,student.rows[0].batch_id,'Imported Fee Payment',row.amount,row.date]);
          await client.query(`insert into public.fees(id,student_id,description,amount,due_date,status,record_json) values($1,$2,$3,$4,$5,'paid',$6::jsonb)`,[feeId,student.rows[0].id,fee.title,row.amount,row.date,JSON.stringify(fee)]);
          await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)', ['Fees',feeId,JSON.stringify(fee)]);
          const payment={_type:'app-data',collection:'payment',id:paymentId,financePaymentId:paymentId,financeFeeId:feeId,feeId,studentId:student.rows[0].id,amount:Number(row.amount),paidAt:row.date,method:'cash',receiptNo,status:'paid'};
          await client.query(`insert into public.fee_payments(id,student_fee_id,student_key,amount,method,paid_at,receipt_no,received_by,idempotency_key) values($1,$2,$3,$4,'cash',$5,$6,$7,$8)`,[paymentId,feeId,student.rows[0].id,row.amount,row.date,receiptNo,actor.email,`import:${crypto.createHash('sha256').update(`${row.line}:${row.studentId}:${row.admission}:${row.amount}:${row.date}`).digest('hex')}`]);
          await client.query(`insert into public.payments(id,fee_id,student_id,amount,paid_at,status,receipt_number,record_json) values($1,$2,$3,$4,$5,'paid',$6,$7::jsonb)`,[paymentId,feeId,student.rows[0].id,row.amount,row.date,receiptNo,JSON.stringify(payment)]);
          await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb)', ['Fees',paymentId,JSON.stringify(payment)]);
        }
        await client.query('commit');invalidate();return json(res,201,{imported:parsed.length,rowErrors:[]});
      }catch(error){await client.query('rollback');if(error.statusCode)return json(res,error.statusCode,{error:'CSV was not imported; no rows were saved.',rowErrors:[{line:Number((error.message.match(/Row (\d+)/)||[])[1])||0,error:error.message}]});throw error;}finally{client.release();}
    }
    if (method === 'POST' && endpoint === '/api/admin/finance/fees/assign') {
      const structureId=clean(input.structureId,80), scope=clean(input.scope,20), batchIds=Array.isArray(input.batchIds)?input.batchIds.map(x=>clean(x,80)).slice(0,500):[], studentKeys=Array.isArray(input.studentKeys)?input.studentKeys.map(x=>clean(x,100)).slice(0,500):[], courseId=clean(input.courseId,80), dueDate=input.dueDate||null;
      if (!structureId || !['course','batch','student'].includes(scope) || !validDate(dueDate)) return json(res,400,{error:'Check the fee structure assignment fields.'});
      const client=await pool.connect();
      try { await client.query('begin');
        const structure=await client.query('select * from public.fee_structures where id=$1 and active=true for update',[structureId]);
        if(!structure.rowCount){await client.query('rollback');return json(res,404,{error:'Fee structure was not found.'});}
        const row=structure.rows[0];
        const inserted=await client.query(`with selected as (
          select s.id,s.batch_id from public.students s left join public.batches b on b.id=s.batch_id
          where ($1::text='student' and s.id=any($2::text[])) or ($1::text='batch' and s.batch_id=any($3::text[])) or ($1::text='course' and b.course_id=$4)
        ), created as (
          insert into public.student_fees(id,student_key,batch_id,structure_id,title,fee_type_id,total_amount,due_date,status)
          select gen_random_uuid()::text,s.id,s.batch_id,$5,$6,$7,$8,coalesce($9::date,$10::date),case when coalesce($9::date,$10::date)<current_date then 'overdue' else 'upcoming' end
          from selected s on conflict do nothing returning id,student_key,batch_id,title,total_amount,due_date
        ), compatibility_fees as (
          insert into public.fees(id,student_id,description,amount,due_date,status,record_json)
          select f.id,f.student_key,f.title,f.total_amount,f.due_date,'pending',jsonb_build_object('_type','app-data','collection','fee','id',f.id,'studentId',f.student_key,'batchId',coalesce(f.batch_id,''),'description',f.title,'amount',f.total_amount,'dueDate',f.due_date,'status','pending','financeFeeId',f.id)
          from created f on conflict(id) do nothing returning id
        ), compatibility_records as (
          insert into public.app_records(source_tab,record_id,record_json)
          select 'Fees',f.id,jsonb_build_object('_type','app-data','collection','fee','id',f.id,'studentId',f.student_key,'batchId',coalesce(f.batch_id,''),'description',f.title,'amount',f.total_amount,'dueDate',f.due_date,'status','pending','financeFeeId',f.id)
          from created f on conflict(source_tab,record_id) do nothing returning record_id
        ) select count(*)::int created_count from created`,[scope,studentKeys,batchIds,courseId,structureId,row.title,row.fee_type_id,row.total_amount,dueDate,row.due_date]);
        await client.query('commit'); invalidate(); return json(res,201,{created:safeNum(inserted.rows[0]?.created_count)});
      } catch(error){await client.query('rollback');throw error;} finally{client.release();}
    }
    let match;
    if (method === 'POST' && (match=endpoint.match(/^\/api\/admin\/finance\/fees\/([^/]+)\/payments$/))) {
      const feeId=clean(decodeURIComponent(match[1]),80), amount=String(input.amount??''), methodName=clean(input.method,40).toLowerCase(), idempotency=clean(input.idempotencyKey,100), reference=clean(input.reference,160);
      if(!validAmount(amount)||!allowedMethods.has(methodName)||!idempotency)return json(res,400,{error:'Check the payment amount, method and request key.'});
      const client=await pool.connect();
      try{await client.query('begin');
        const prior=await client.query('select id,receipt_no,amount from public.fee_payments where idempotency_key=$1',[idempotency]);
        if(prior.rowCount){await client.query('commit');return json(res,200,{payment:prior.rows[0],replayed:true});}
        const found=await client.query('select * from public.student_fees where id=$1 for update',[feeId]);
        if(!found.rowCount){await client.query('rollback');return json(res,404,{error:'Fee record was not found.'});}
        const fee=found.rows[0], totals=await client.query('select coalesce(sum(amount),0)::numeric paid,coalesce(sum(discount_amount),0)::numeric discounts,coalesce(sum(fine_amount),0)::numeric fines from public.fee_payments where student_fee_id=$1 and reversed_at is null',[feeId]);
        const paid=safeNum(totals.rows[0]?.paid), discount=safeNum(totals.rows[0]?.discounts), fines=safeNum(totals.rows[0]?.fines), balance=Math.max(0,safeNum(fee.total_amount)-paid-discount-fines);
        if(Number(amount)>balance){await client.query('rollback');return json(res,409,{error:'Payment exceeds the remaining fee balance.'});}
        const paymentId=id(), receiptNo=`MJM-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`, paidAt=input.paidAt||new Date().toISOString();
        await client.query(`insert into public.fee_payments(id,student_fee_id,student_key,amount,method,reference,paid_at,receipt_no,received_by,idempotency_key)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[paymentId,feeId,fee.student_key,amount,methodName,reference,paidAt,receiptNo,actor.email,idempotency]);
        const nextStatus=balance-Number(amount)<=0?'paid':paid+Number(amount)>0?'partial':fee.due_date&&fee.due_date<new Date().toISOString().slice(0,10)?'overdue':'upcoming';
        await client.query('update public.student_fees set status=$2,updated_at=now() where id=$1',[feeId,nextStatus]);
        const paymentJson={_type:'app-data',collection:'payment',id:paymentId,financePaymentId:paymentId,financeFeeId:feeId,feeId,studentId:fee.student_key,amount:Number(amount),paidAt,method:methodName,reference,receiptNo:receiptNo,status:'paid'};
        await client.query(`insert into public.payments(id,fee_id,student_id,amount,paid_at,status,receipt_number,record_json) values($1,$2,$3,$4,$5,'paid',$6,$7::jsonb)`,[paymentId,feeId,fee.student_key,amount,paidAt,receiptNo,JSON.stringify(paymentJson)]);
        await client.query('insert into public.app_records(source_tab,record_id,record_json) values($1,$2,$3::jsonb) on conflict(source_tab,record_id) do nothing',['Fees',paymentId,JSON.stringify(paymentJson)]);
        await client.query('commit');invalidate();return json(res,201,{payment:{id:paymentId,receiptNo,amount:Number(amount),paidAt,method:methodName},balance:Math.max(0,balance-Number(amount))});
      }catch(error){await client.query('rollback');if(error.code==='23505'){const prior=await pool.query('select id,receipt_no,amount from public.fee_payments where idempotency_key=$1',[idempotency]);if(prior.rowCount)return json(res,200,{payment:prior.rows[0],replayed:true});}throw error;}finally{client.release();}
    }
    if (method === 'GET' && (match=endpoint.match(/^\/api\/admin\/finance\/fees\/([^/]+)\/ledger$/))) {
      const result=await pool.query(`select p.id,p.amount,p.fine_amount,p.discount_amount,p.method,p.reference,p.paid_at,p.receipt_no,p.reversed_at,p.received_by
        from public.fee_payments p where p.student_fee_id=$1 order by p.paid_at desc`,[clean(decodeURIComponent(match[1]),80)]);
      return json(res,200,{items:result.rows});
    }
    if (method === 'POST' && (match=endpoint.match(/^\/api\/admin\/finance\/payments\/([^/]+)\/reverse$/))) {
      const paymentId=clean(decodeURIComponent(match[1]),80),reason=clean(input.reason,500);
      if(reason.length<3)return json(res,400,{error:'Enter a reason for reversing this payment.'});
      const client=await pool.connect();try{await client.query('begin');
        const result=await client.query('select * from public.fee_payments where id=$1 for update',[paymentId]);
        if(!result.rowCount||result.rows[0].reversed_at){await client.query('rollback');return json(res,404,{error:'Active payment was not found.'});}
        const p=result.rows[0];await client.query('update public.fee_payments set reversed_at=now() where id=$1',[paymentId]);
        const totals=await client.query('select coalesce(sum(amount),0)::numeric paid,coalesce(sum(discount_amount),0)::numeric discounts,coalesce(sum(fine_amount),0)::numeric fines from public.fee_payments where student_fee_id=$1 and reversed_at is null',[p.student_fee_id]);
        const fee=await client.query('select total_amount,due_date from public.student_fees where id=$1 for update',[p.student_fee_id]);
        const balance=Math.max(0,safeNum(fee.rows[0]?.total_amount)-safeNum(totals.rows[0]?.paid)-safeNum(totals.rows[0]?.discounts)-safeNum(totals.rows[0]?.fines));
        const status=balance===0?'paid':fee.rows[0]?.due_date&&fee.rows[0].due_date<new Date().toISOString().slice(0,10)?'overdue':safeNum(totals.rows[0]?.paid)>0?'partial':'upcoming';
        await client.query('update public.student_fees set status=$2,updated_at=now() where id=$1',[p.student_fee_id,status]);
        await client.query('update public.payments set amount=-abs(amount),status=$2,record_json=record_json||jsonb_build_object(\'status\',$2,\'reversedAt\',now()) where id=$1',[paymentId,'reversed']);
        await client.query(`insert into public.fee_payment_deletions(id,payment_id,student_fee_id,student_key,payment_snapshot,principal,net_reversed,fine_reversed,deleted_by,reason)
          values($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,[id(),paymentId,p.student_fee_id,p.student_key,JSON.stringify(p),p.amount,p.amount,p.fine_amount,actor.email,reason]);
        await client.query('commit');invalidate();return json(res,200,{ok:true});
      }catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if (method === 'GET' && endpoint === '/api/admin/finance/payments/audit') {
      const q=url.searchParams, search=clean(q.get('search'),120);if(!validDate(q.get('from'))||!validDate(q.get('to')))return json(res,400,{error:'Enter valid audit dates.'});const result=await pool.query(`select d.id,d.payment_id,d.student_key,d.payment_snapshot,d.principal,d.net_reversed,d.fine_reversed,d.deleted_by,d.deleted_at,d.reason,
        s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number from public.fee_payment_deletions d left join public.students s on s.id=d.student_key
        where ($1='' or s.name ilike '%'||$1||'%' or coalesce(s.roll,s.record_json->>'admissionNumber','') ilike '%'||$1||'%' or d.deleted_by ilike '%'||$1||'%')
        and ($2::date is null or d.deleted_at::date >= $2::date) and ($3::date is null or d.deleted_at::date <= $3::date)
        and ($4='all' or lower(coalesce(d.payment_snapshot->>'method',''))=$4) order by d.deleted_at desc limit 100`,[search,q.get('from')||null,q.get('to')||null,clean(q.get('method')||'all',30).toLowerCase()]);
      const stats=await cached('audit:stats',async()=>{const s=(await pool.query(`select count(*) total,count(*) filter(where deleted_at>=date_trunc('month',current_date)) this_month,coalesce(sum(principal),0)::numeric principal,coalesce(sum(net_reversed),0)::numeric net,coalesce(sum(fine_reversed),0)::numeric fine from public.fee_payment_deletions`)).rows[0]||{};return s;});
      return json(res,200,{items:result.rows,stats:{total:safeNum(stats.total),thisMonth:safeNum(stats.this_month),principal:safeNum(stats.principal),net:safeNum(stats.net),fine:safeNum(stats.fine)}});
    }
    if (method === 'GET' && endpoint === '/api/admin/finance/structures') {
      const q=url.searchParams, scope=clean(q.get('scope')||'all',20);
      const [result,summary]=await Promise.all([
        queryWithLimit(()=>pool.query(`select f.id,f.title,f.fee_type_id,f.component_group,f.total_amount,f.frequency,f.academic_year_id,f.scope,f.mandatory_enrollment,f.due_date,f.notes,f.active,
        coalesce((select count(*) from public.fee_structure_targets t where t.structure_id=f.id and t.batch_id is not null),0)::int batch_targets,
        coalesce((select count(*) from public.fee_structure_targets t where t.structure_id=f.id and t.student_key is not null),0)::int student_targets
        from public.fee_structures f where ($1='all' or f.scope=$1) order by f.created_at desc limit 200`,[scope])),
        queryWithLimit(()=>pool.query(`select count(*)::int templates,count(*) filter(where scope='batch')::int batch_templates,count(*) filter(where scope='student')::int student_specific,coalesce(sum(total_amount) filter(where active),0)::numeric active_value_sum from public.fee_structures`)),
      ]);
      return json(res,200,{items:result.rows,stats:summary.rows[0]||{templates:0,batch_templates:0,student_specific:0,active_value_sum:0}});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/structures'){
      const title=clean(input.title),feeTypeId=clean(input.feeTypeId,80),group=clean(input.componentGroup||'Other',80),amount=String(input.amount??''),frequency=clean(input.frequency||'one-time',30),scope=clean(input.scope||'global',20),academicYearId=clean(input.academicYearId,80),dueDate=input.dueDate||null,notes=clean(input.notes,1000);
      if(title.length<2||!validAmount(amount)||!['one-time','monthly','quarterly','annual','custom'].includes(frequency)||!['global','batch','student'].includes(scope)||!validDate(dueDate))return json(res,400,{error:'Check the fee structure details.'});
      const result=await pool.query(`insert into public.fee_structures(id,title,fee_type_id,component_group,total_amount,frequency,academic_year_id,scope,mandatory_enrollment,due_date,notes,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,[id(),title,feeTypeId,group,amount,frequency,academicYearId||null,scope,input.mandatoryEnrollment===true,dueDate,notes,actor.email]);
      invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/discounts'){
      const result=await pool.query(`select d.id,d.name,d.code,d.discount_type,d.value,d.applies_to,d.valid_from,d.valid_to,d.usage_limit,d.used_count,d.active,count(r.id)::int redemption_count
        from public.discounts d left join public.discount_redemptions r on r.discount_id=d.id group by d.id order by d.created_at desc limit 200`);
      return json(res,200,{items:result.rows});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/discounts'){
      const name=clean(input.name),code=clean(input.code,40).toUpperCase(),type=clean(input.type,12),value=String(input.value??''),from=input.validFrom||null,to=input.validTo||null,usage=input.usageLimit===''||input.usageLimit==null?null:Number(input.usageLimit);
      if(name.length<2||!/^[A-Z0-9_-]{2,40}$/.test(code)||!['percent','flat'].includes(type)||!validAmount(value)||type==='percent'&&Number(value)>100||!validDate(from)||!validDate(to)||usage!==null&&(!Number.isInteger(usage)||usage<1))return json(res,400,{error:'Check the discount details.'});
      try{const result=await pool.query(`insert into public.discounts(id,name,code,discount_type,value,applies_to,valid_from,valid_to,usage_limit) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,[id(),name,code,type,value,clean(input.appliesTo||'all',40),from,to,usage]);invalidate();return json(res,201,{item:result.rows[0]});}catch(error){if(error.code==='23505')return json(res,409,{error:'A discount with this code already exists.'});throw error;}
    }
    if(method==='POST'&&(match=endpoint.match(/^\/api\/admin\/finance\/fees\/([^/]+)\/discount$/))){
      const discountId=clean(input.discountId,80),feeId=clean(decodeURIComponent(match[1]),80),client=await pool.connect();try{await client.query('begin');
        const fee=await client.query('select * from public.student_fees where id=$1 for update',[feeId]),discount=await client.query('select * from public.discounts where id=$1 and active=true for update',[discountId]);
        if(!fee.rowCount||!discount.rowCount){await client.query('rollback');return json(res,404,{error:'Fee or discount was not found.'});}
        const d=discount.rows[0];if(d.valid_from&&d.valid_from>new Date().toISOString().slice(0,10)||d.valid_to&&d.valid_to<new Date().toISOString().slice(0,10)||d.usage_limit!==null&&d.used_count>=d.usage_limit){await client.query('rollback');return json(res,409,{error:'This discount is outside its validity or usage limit.'});}
        const balance=await client.query('select coalesce(sum(amount),0)::numeric paid from public.fee_payments where student_fee_id=$1 and reversed_at is null',[feeId]);const remaining=Math.max(0,safeNum(fee.rows[0].total_amount)-safeNum(balance.rows[0]?.paid));const value=d.discount_type==='percent'?remaining*Number(d.value)/100:Number(d.value);const applied=Math.min(remaining,Math.round(value*100)/100);
        if(applied<=0){await client.query('rollback');return json(res,409,{error:'There is no remaining balance for this discount.'});}
        await client.query('insert into public.discount_redemptions(id,discount_id,student_key,student_fee_id,amount,redeemed_by) values($1,$2,$3,$4,$5,$6)',[id(),discountId,fee.rows[0].student_key,feeId,applied,actor.email]);await client.query('update public.discounts set used_count=used_count+1,updated_at=now() where id=$1',[discountId]);
        await client.query('insert into public.fee_payments(id,student_fee_id,student_key,amount,discount_amount,method,reference,receipt_no,received_by,idempotency_key) values($1,$2,$3,0,$4,$5,$6,$7,$8,$9)',[id(),feeId,fee.rows[0].student_key,applied,'discount',d.code,`DISC-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,actor.email,`discount:${discountId}:${feeId}`]);await client.query('commit');invalidate();return json(res,200,{applied});
      }catch(error){await client.query('rollback');if(error.code==='23505')return json(res,409,{error:'This discount is already applied to this fee.'});throw error;}finally{client.release();}
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/emi'){
      const [plans,installs,summary]=await Promise.all([
        queryWithLimit(()=>pool.query('select id,name,installments,interval_days,active,created_at from public.emi_plans order by created_at desc')),
        queryWithLimit(()=>pool.query(`select i.id,i.student_fee_id,i.tranche_no,i.due_date,i.amount,i.collected,greatest(i.amount-i.collected,0)::numeric balance,
          case when i.amount<=i.collected then 'Paid' when i.due_date<current_date then 'Overdue' else 'Pending' end status,
          f.student_key,f.title,s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number from public.emi_installments i
          join public.student_fees f on f.id=i.student_fee_id join public.students s on s.id=f.student_key order by i.due_date limit 300`)),
        queryWithLimit(()=>pool.query(`select count(*)::int total,count(*) filter(where due_date between current_date and current_date+6 and collected<amount)::int due_week,
          coalesce(sum(amount-collected) filter(where collected<amount),0)::numeric pending from public.emi_installments`)),
      ]);
      return json(res,200,{plans:plans.rows,installments:installs.rows,stats:summary.rows[0]||{total:0,due_week:0,pending:0}});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/emi/plans'){
      const name=clean(input.name),installments=Number(input.installments),interval=Number(input.intervalDays);if(name.length<2||!Number.isInteger(installments)||installments<2||installments>60||!Number.isInteger(interval)||interval<1||interval>365)return json(res,400,{error:'Check the EMI plan details.'});
      const result=await pool.query('insert into public.emi_plans(id,name,installments,interval_days) values($1,$2,$3,$4) returning *',[id(),name,installments,interval]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/emi/assign'){
      const feeId=clean(input.studentFeeId,80),planId=clean(input.planId,80),firstDue=input.firstDueDate; if(!validDate(firstDue))return json(res,400,{error:'Enter a valid first due date.'});
      const client=await pool.connect();try{await client.query('begin');const [fee,plan]=await Promise.all([client.query('select * from public.student_fees where id=$1 for update',[feeId]),client.query('select * from public.emi_plans where id=$1 and active=true',[planId])]);if(!fee.rowCount||!plan.rowCount){await client.query('rollback');return json(res,404,{error:'Fee or EMI plan was not found.'});}
        const existing=await client.query('select count(*)::int count from public.emi_installments where student_fee_id=$1',[feeId]);if(Number(existing.rows[0]?.count)>0){await client.query('rollback');return json(res,409,{error:'This fee already has an installment plan.'});}
        const p=plan.rows[0],feeRow=fee.rows[0],cents=Math.round(Number(feeRow.total_amount)*100),base=Math.floor(cents/p.installments),rest=cents-base*p.installments;for(let i=1;i<=p.installments;i++){const amount=(base+(i===p.installments?rest:0))/100,due=new Date(`${firstDue}T00:00:00Z`);due.setUTCDate(due.getUTCDate()+(i-1)*p.interval_days);await client.query('insert into public.emi_installments(id,student_fee_id,plan_id,tranche_no,due_date,amount) values($1,$2,$3,$4,$5,$6)',[id(),feeId,planId,i,due.toISOString().slice(0,10),amount]);}
        await client.query('commit');invalidate();return json(res,201,{created:p.installments,total:Number(feeRow.total_amount)});
      }catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/late-fees'){
      const [rules,stats]=await Promise.all([queryWithLimit(()=>pool.query('select id,name,rule_type,amount,grace_days,max_cap,active,created_at from public.late_fee_rules order by created_at desc')),queryWithLimit(()=>pool.query("select count(*)::int overdue,(select count(*)::int from public.late_fee_rules where active=true) active_rules from public.student_fees where due_date<current_date and status not in ('paid','waived')"))]);return json(res,200,{items:rules.rows,stats:stats.rows[0]||{overdue:0,active_rules:0}});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/late-fees'){
      const name=clean(input.name),type=clean(input.type,12),amount=String(input.amount??''),grace=Number(input.graceDays||0),cap=input.maxCap?String(input.maxCap):null;if(name.length<2||!['fixed','percent'].includes(type)||!validAmount(amount)||type==='percent'&&Number(amount)>100||!Number.isInteger(grace)||grace<0||grace>365||cap&&!validAmount(cap))return json(res,400,{error:'Check the late fee rule details.'});const result=await pool.query('insert into public.late_fee_rules(id,name,rule_type,amount,grace_days,max_cap) values($1,$2,$3,$4,$5,$6) returning *',[id(),name,type,amount,grace,cap]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/late-fees/apply-now'){
      const client=await pool.connect();try{await client.query('begin');const result=await client.query(`insert into public.late_fee_applications(id,rule_id,student_fee_id,applied_on,amount)
        select gen_random_uuid()::text,r.id,f.id,current_date,case when r.rule_type='percent' then least(round(f.total_amount*r.amount/100,2),coalesce(r.max_cap,999999999)) else least(r.amount,coalesce(r.max_cap,999999999)) end
        from public.late_fee_rules r join public.student_fees f on true
          where r.active=true and f.due_date<current_date-r.grace_days and f.status not in ('paid','waived')
        on conflict(rule_id,student_fee_id,applied_on) do nothing returning id`);await client.query('commit');invalidate();return json(res,200,{applied:result.rowCount});}catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/reminders'){
      const [rules,activity,stats]=await Promise.all([queryWithLimit(()=>pool.query('select id,name,trigger,days,send_time,channels,email_subject,email_body,sms_template,whatsapp_template,active from public.reminder_rules order by created_at desc')),queryWithLimit(()=>pool.query(`select l.id,l.channel,l.status,l.sent_at,l.detail,s.name student_name from public.reminder_log l left join public.students s on s.id=l.student_key order by l.sent_at desc limit 50`)),queryWithLimit(()=>pool.query(`select count(*) filter(where active)::int active_rules,(select count(*)::int from public.reminder_log where sent_at>=date_trunc('month',current_date)) sent_month,(select count(*)::int from public.reminder_log) total_sent,(select count(*)::int from public.student_fees where due_date<current_date and status not in ('paid','waived')) overdue from public.reminder_rules`))]);return json(res,200,{items:rules.rows,activity:activity.rows,stats:stats.rows[0]||{active_rules:0,sent_month:0,total_sent:0,overdue:0},channels:{email:false,sms:false,whatsapp:false}});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/reminders'){
      const name=clean(input.name),trigger=clean(input.trigger,20),days=Number(input.days||0),sendTime=clean(input.sendTime||'09:00',5),channels=Array.isArray(input.channels)?input.channels.filter(c=>['in_app','email','sms','whatsapp'].includes(c)):[];if(name.length<2||!['before_due','on_due','after_due'].includes(trigger)||!Number.isInteger(days)||days<0||days>365||!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)||!channels.length)return json(res,400,{error:'Check the reminder rule details.'});for(const channel of channels){if(channel!=='in_app')return json(res,409,{error:`${channel} is not connected. Configure it in Integrations first.`});}
      const result=await pool.query(`insert into public.reminder_rules(id,name,trigger,days,send_time,channels,email_subject,email_body,sms_template,whatsapp_template) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) returning id,name,trigger,days,send_time,channels,active`,[id(),name,trigger,days,sendTime,JSON.stringify(channels),clean(input.emailSubject,180),clean(input.emailBody,3000),clean(input.smsTemplate,160),clean(input.whatsappTemplate,1000)]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/reminders/send-now'){
      const result=await pool.query(`insert into public.reminder_log(id,rule_id,student_key,channel,status,detail)
        select gen_random_uuid()::text,null,f.student_key,'in_app','queued','In-app reminder queued'
        from (select distinct on(student_key) student_key,due_date from public.student_fees where due_date<=current_date+7 and status not in ('paid','waived') order by student_key,due_date) f
        and not exists(select 1 from public.reminder_log l where l.student_key=f.student_key and l.channel='in_app' and l.sent_at::date=current_date)
        returning id`);invalidate();return json(res,200,{queued:result.rowCount,externalChannels:'not_connected'});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/expenses'){
      const q=url.searchParams,search=clean(q.get('search'),120),from=q.get('from')||null,to=q.get('to')||null;const [list,stats]=await Promise.all([queryWithLimit(()=>pool.query(`select e.id,e.title,e.amount,e.spent_on,e.method,e.reference,e.notes,h.name head_name,e.created_at from public.expenses e left join public.expense_heads h on h.id=e.head_id where ($1='' or e.title ilike '%'||$1||'%' or h.name ilike '%'||$1||'%') and ($2::date is null or e.spent_on>=$2::date) and ($3::date is null or e.spent_on<=$3::date) order by e.spent_on desc,e.created_at desc limit 100`,[search,from,to])),queryWithLimit(()=>pool.query(`select count(*)::int count,coalesce(sum(amount),0)::numeric total,coalesce(sum(amount) filter(where spent_on>=date_trunc('month',current_date)),0)::numeric month from public.expenses`))]);return json(res,200,{items:list.rows,stats:stats.rows[0]||{count:0,total:0,month:0}});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/expense-heads')return json(res,200,{items:(await pool.query('select id,name,description,active,created_at from public.expense_heads order by name')).rows});
    if(method==='POST'&&endpoint==='/api/admin/finance/expense-heads'){
      const name=clean(input.name),description=clean(input.description,500);if(name.length<2)return json(res,400,{error:'Enter an expense category name.'});const result=await pool.query('insert into public.expense_heads(id,name,description) values($1,$2,$3) returning *',[id(),name,description]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/expenses'){
      const title=clean(input.title),headId=clean(input.headId,80),amount=String(input.amount??''),date=input.date,methodName=clean(input.method,40);if(title.length<2||!validAmount(amount)||!validDate(date)||!date||!allowedMethods.has(methodName.toLowerCase()))return json(res,400,{error:'Check the expense details.'});const result=await pool.query('insert into public.expenses(id,head_id,title,amount,spent_on,method,reference,notes,recorded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,title,amount,spent_on,method,reference,notes,created_at',[id(),headId||null,title,amount,date,methodName,clean(input.reference,160),clean(input.notes,1000),actor.email]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/income'){
      const q=url.searchParams,search=clean(q.get('search'),120),from=q.get('from')||null,to=q.get('to')||null;const [list,stats]=await Promise.all([queryWithLimit(()=>pool.query(`select i.id,i.title,i.amount,i.received_on,i.method,i.reference,i.notes,h.name head_name,i.created_at from public.income_records i left join public.income_heads h on h.id=i.head_id where ($1='' or i.title ilike '%'||$1||'%' or h.name ilike '%'||$1||'%') and ($2::date is null or i.received_on>=$2::date) and ($3::date is null or i.received_on<=$3::date) order by i.received_on desc,i.created_at desc limit 100`,[search,from,to])),queryWithLimit(()=>pool.query('select count(*)::int count,coalesce(sum(amount),0)::numeric total,coalesce(sum(amount) filter(where received_on>=date_trunc(\'month\',current_date)),0)::numeric month from public.income_records'))]);return json(res,200,{items:list.rows,stats:stats.rows[0]||{count:0,total:0,month:0}});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/income-heads')return json(res,200,{items:(await pool.query('select id,name,description,active,created_at from public.income_heads order by name')).rows});
    if(method==='POST'&&endpoint==='/api/admin/finance/income-heads'){
      const name=clean(input.name),description=clean(input.description,500);if(name.length<2)return json(res,400,{error:'Enter an income category name.'});const result=await pool.query('insert into public.income_heads(id,name,description) values($1,$2,$3) returning *',[id(),name,description]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='POST'&&endpoint==='/api/admin/finance/income'){
      const title=clean(input.title),headId=clean(input.headId,80),amount=String(input.amount??''),date=input.date,methodName=clean(input.method,40);if(title.length<2||!validAmount(amount)||!validDate(date)||!date||!allowedMethods.has(methodName.toLowerCase()))return json(res,400,{error:'Check the income details.'});const result=await pool.query('insert into public.income_records(id,head_id,title,amount,received_on,method,reference,notes,recorded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id,title,amount,received_on,method,reference,notes,created_at',[id(),headId||null,title,amount,date,methodName,clean(input.reference,160),clean(input.notes,1000),actor.email]);invalidate();return json(res,201,{item:result.rows[0]});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/report'){
      const q=url.searchParams,from=q.get('from')||'1900-01-01',to=q.get('to')||'2999-12-31';if(!validDate(from)||!validDate(to))return json(res,400,{error:'Enter a valid report date range.'});const result=await pool.query(`select count(*)::int payment_count,coalesce(sum(amount),0)::numeric collected,coalesce(sum(amount) filter(where paid_at>=date_trunc('month',current_date)),0)::numeric month_total,
        coalesce(sum(amount) filter(where method='cash'),0)::numeric cash,coalesce(sum(amount) filter(where method='upi'),0)::numeric upi,coalesce(sum(amount) filter(where method='bank transfer'),0)::numeric bank
        from public.fee_payments where reversed_at is null and paid_at::date between $1::date and $2::date`,[from,to]);const rows=(await pool.query(`select p.receipt_no,p.paid_at,p.amount,p.method,p.reference,s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number,f.title fee_title from public.fee_payments p join public.student_fees f on f.id=p.student_fee_id join public.students s on s.id=p.student_key where p.reversed_at is null and p.paid_at::date between $1::date and $2::date order by p.paid_at desc limit 500`,[from,to]));return json(res,200,{stats:result.rows[0]||{},items:rows.rows});
    }
    if(method==='GET'&&endpoint==='/api/admin/finance/export'){
      const q=url.searchParams,kind=clean(q.get('kind')||'fees',24),format=clean(q.get('format')||'standard',24),from=q.get('from')||'1900-01-01',to=q.get('to')||'2999-12-31';if(!['fees','payroll','defaulters'].includes(kind)||!validDate(from)||!validDate(to))return json(res,400,{error:'Check the export type and date range.'});let rows=[];
      if(kind==='fees'){rows=(await pool.query(`select p.receipt_no,s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number,f.title,p.amount,p.paid_at,p.method,p.reference from public.fee_payments p join public.students s on s.id=p.student_key join public.student_fees f on f.id=p.student_fee_id where p.reversed_at is null and p.paid_at::date between $1::date and $2::date order by p.paid_at`,[from,to])).rows;}
      if(kind==='defaulters'){rows=(await pool.query(`select s.name student_name,coalesce(s.phone,'') phone,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number,b.name batch,f.title fee_title,f.due_date,f.total_amount,coalesce(p.paid,0)::numeric paid,greatest(f.total_amount-coalesce(p.paid,0),0)::numeric balance from public.student_fees f join public.students s on s.id=f.student_key left join public.batches b on b.id=f.batch_id left join lateral(select sum(amount) paid from public.fee_payments where student_fee_id=f.id and reversed_at is null)p on true where f.due_date between $1::date and $2::date and f.total_amount>coalesce(p.paid,0) order by f.due_date`,[from,to])).rows;}
      if(kind==='payroll'){try{rows=(await pool.query(`select p.employee_id,s.name,p.amount,p.paid_at,p.status from public.payroll p left join public.staff s on s.id=p.employee_id where p.paid_at::date between $1::date and $2::date order by p.paid_at`,[from,to])).rows;}catch(error){if(error.code!=='42P01'&&error.code!=='42703')throw error;log(endpoint,'optional payroll export schema',error);rows=[];}}
      const columns=kind==='fees'?['receipt_no','student_name','admission_number','title','amount','paid_at','method','reference']:kind==='payroll'?['employee_id','name','amount','paid_at','status']:['student_name','phone','admission_number','batch','fee_title','due_date','total_amount','paid','balance'];
      const formulaSafe=value=>{const text=String(value??'');return /^[=+\-@\t\r]/.test(text)?`'${text}`:text;};const csv=[columns.join(','),...rows.map(row=>columns.map(key=>`"${formulaSafe(row[key]).replace(/"/g,'""')}"`).join(','))].join('\r\n');res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="finance-${kind}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(`${format==='tally'?'\uFEFF':''}${csv}`);return res;
    }
    return json(res,404,{error:'Finance route not found.'});
  } catch(error) { return fail(res,endpoint,'request handler',error); }
}

const smokeQueries = {
  fees: [SQL.feeStats, SQL.feeList],
  lookups: [
    'select id,student_id,name,roll,batch_id,status from public.students order by name limit 1',
    'select id,name,course_id,course_name,active from public.batches order by name limit 1',
    'select id,name,status from public.courses order by name limit 1',
    'select id,name,start_date,end_date,status from public.academic_years order by start_date desc nulls last limit 1',
    "select staff_key,name,employee_id,status from public.staff where lower(coalesce(status,'')) not in ('inactive','left','terminated') order by name limit 1",
    'select id,name,component_group,badge_color,active from public.fee_types where active=true order by name',
  ],
  feeTypes: ['select id,name,component_group,badge_color,active from public.fee_types where active=true order by name'],
  structures: ['select f.id,f.title,f.fee_type_id,f.component_group,f.total_amount,f.frequency,f.academic_year_id,f.scope,f.mandatory_enrollment,f.due_date,f.notes,f.active from public.fee_structures f where ($1=\'all\' or f.scope=$1) order by f.created_at desc limit 1'],
  structureStats: ['select count(*)::int templates,count(*) filter(where scope=\'batch\')::int batch_templates,count(*) filter(where scope=\'student\')::int student_specific,coalesce(sum(total_amount) filter(where active),0)::numeric active_value_sum from public.fee_structures'],
  discounts: ['select d.id,d.name,d.code,d.discount_type,d.value,d.applies_to,d.valid_from,d.valid_to,d.usage_limit,d.used_count,d.active,count(r.id)::int redemption_count from public.discounts d left join public.discount_redemptions r on r.discount_id=d.id group by d.id order by d.created_at desc limit 1'],
  emi: ['select id,name,installments,interval_days,active,created_at from public.emi_plans order by created_at desc limit 1','select i.id,i.student_fee_id,i.tranche_no,i.due_date,i.amount,i.collected from public.emi_installments i order by i.due_date limit 1','select count(*)::int total,count(*) filter(where due_date between current_date and current_date+6 and collected<amount)::int due_week,coalesce(sum(amount-collected) filter(where collected<amount),0)::numeric pending from public.emi_installments'],
  reminders: ['select id,name,trigger,days,send_time,channels,active from public.reminder_rules order by created_at desc limit 1','select id,channel,status,sent_at,detail from public.reminder_log order by sent_at desc limit 1',"select count(*) filter(where active)::int active_rules,(select count(*)::int from public.reminder_log where sent_at>=date_trunc('month',current_date)) sent_month,(select count(*)::int from public.reminder_log) total_sent,(select count(*)::int from public.student_fees where due_date<current_date and status not in ('paid','waived')) overdue from public.reminder_rules"],
  lateFees: ['select id,name,rule_type,amount,grace_days,max_cap,active from public.late_fee_rules order by created_at desc limit 1',"select count(*)::int overdue,(select count(*)::int from public.late_fee_rules where active=true) active_rules from public.student_fees where due_date<current_date and status not in ('paid','waived')", "select r.id,f.id,case when r.rule_type='percent' then least(round(f.total_amount*r.amount/100,2),coalesce(r.max_cap,999999999)) else least(r.amount,coalesce(r.max_cap,999999999)) end amount from public.late_fee_rules r join public.student_fees f on true where r.active=true and f.due_date<current_date-r.grace_days and f.status not in ('paid','waived')"],
  expenses: ['select e.id,e.title,e.amount,e.spent_on,e.method,h.name head_name from public.expenses e left join public.expense_heads h on h.id=e.head_id order by e.spent_on desc limit 1','select id,name,description,active from public.expense_heads order by name limit 1',"select count(*)::int count,coalesce(sum(amount),0)::numeric total,coalesce(sum(amount) filter(where spent_on>=date_trunc('month',current_date)),0)::numeric month from public.expenses"],
  income: ['select i.id,i.title,i.amount,i.received_on,i.method,h.name head_name from public.income_records i left join public.income_heads h on h.id=i.head_id order by i.received_on desc limit 1','select id,name,description,active from public.income_heads order by name limit 1',"select count(*)::int count,coalesce(sum(amount),0)::numeric total,coalesce(sum(amount) filter(where received_on>=date_trunc('month',current_date)),0)::numeric month from public.income_records"],
  audit: ['select d.id,d.payment_id,d.student_key,d.principal,d.net_reversed,d.fine_reversed,d.deleted_by,d.deleted_at,d.reason,s.name from public.fee_payment_deletions d left join public.students s on s.id=d.student_key order by d.deleted_at desc limit 1',"select count(*) total,count(*) filter(where deleted_at>=date_trunc('month',current_date)) this_month,coalesce(sum(principal),0)::numeric principal,coalesce(sum(net_reversed),0)::numeric net,coalesce(sum(fine_reversed),0)::numeric fine from public.fee_payment_deletions"],
  report: [
    { sql: `select count(*)::int payment_count,coalesce(sum(amount),0)::numeric collected,coalesce(sum(amount) filter(where paid_at>=date_trunc('month',current_date)),0)::numeric month_total,coalesce(sum(amount) filter(where method='cash'),0)::numeric cash,coalesce(sum(amount) filter(where method='upi'),0)::numeric upi,coalesce(sum(amount) filter(where method='bank transfer'),0)::numeric bank from public.fee_payments where reversed_at is null and paid_at::date between $1::date and $2::date`, values: ['2026-01-01','2026-12-31'] },
    { sql: `select p.receipt_no,p.paid_at,p.amount,p.method,p.reference,s.name student_name,coalesce(s.roll,s.record_json->>'admissionNumber','') admission_number,f.title fee_title from public.fee_payments p join public.student_fees f on f.id=p.student_fee_id join public.students s on s.id=p.student_key where p.reversed_at is null and p.paid_at::date between $1::date and $2::date order by p.paid_at desc limit 1`, values: ['2026-01-01','2026-12-31'] },
  ],
};
module.exports = { route, smokeQueries, invalidate, SQL };
