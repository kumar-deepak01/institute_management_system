'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleStudentPortalRoute, attendanceSummary, ownResultRows } = require('../src/controllers/studentPortalController');

function response() {
  return { statusCode: 0, headers: {}, body: '', writeHead(status, headers) { this.statusCode=status; this.headers=headers; }, end(body) { this.body=body; } };
}
function request(month='2026-10') {
  return { method:'GET', url:`/api/student/portal?month=${month}`, headers:{}, socket:{} };
}

test('student dashboard endpoint returns a scoped profile and page data without a database connection', async () => {
  const queries=[];
  const pool={async query(sql,values){queries.push({sql,values});
    if(sql.includes('from public.students s left join public.batches'))return {rows:[{id:'student-a',student_id:'ADM-A',name:'Student A',email:'a@example.test',batch_id:'batch-a',batch_name:'Batch A',course_id:'course-a',course_name:'Course A',record_json:{}}]};
    if(sql.includes('from public.attendance'))return {rows:[{attendance_date:'2026-10-02',status:'Present',record_json:{}}]};
    if(sql.includes("source_tab in ('Results','Exam Results')"))return {rows:[{record_id:'ra',record_json:{studentId:'ADM-A',score:91},created_at:'2026-10-03'},{record_id:'rb',record_json:{studentId:'ADM-B',score:12},created_at:'2026-10-03'}]};
    if(sql.includes('from public.student_fees'))return {rows:[{id:'fee-a',title:'Tuition',total_amount:'1000',discount_amount:'100',fine_amount:'50',waived_amount:'0',amount_paid:'400',due_date:'2026-10-30',status:'due'}]};
    return {rows:[]};
  }};
  const res=response();
  await handleStudentPortalRoute(request(),res,new URL('http://localhost/api/student/portal?month=2026-10'),{pool,getSession:()=>({accountId:'account-a'}),resolveAccount:async()=>({id:'account-a',role:'student',studentId:'ADM-A',name:'Student A'})});
  const payload=JSON.parse(res.body);
  assert.equal(res.statusCode,200);
  assert.equal(payload.profile.id,'student-a');
  assert.deepEqual(payload.data.results.map(row=>row.id),['ra']);
  assert.deepEqual(payload.data.attendanceSummary,{present:1,absent:0,late:0,excused:0,total:1,rate:100});
  assert.equal(payload.data.fees[0].due,550);
  assert.ok(queries.every(({values})=>!values.includes('student-b')));
  assert.ok(queries.some(({sql,values})=>sql.includes('student_key=any($1::text[])')&&values[0].includes('ADM-A')));
});

test('student dashboard refuses non-student roles and unauthenticated requests', async () => {
  for(const [getSession,resolveAccount,status] of [[()=>null,async()=>null,401],[()=>({}),async()=>({role:'teacher',studentId:'staff-a'}),403]]){
    const res=response();
    await handleStudentPortalRoute(request(),res,new URL('http://localhost/api/student/portal'),{pool:{query:async()=>({rows:[]})},getSession,resolveAccount});
    assert.equal(res.statusCode,status);
  }
});

test('attendance empty state has no percentage while a low recorded rate is measurable', () => {
  assert.deepEqual(attendanceSummary([]),{present:0,absent:0,late:0,excused:0,total:0,rate:null});
  assert.equal(attendanceSummary([{status:'Present'},{status:'Absent'},{status:'Late'}]).rate,33);
});

test('result rows are limited to the matching logged-in student keys', () => {
  const rows=ownResultRows([{record_id:'a',record_json:{studentKey:'student-a',score:80}},{record_id:'b',record_json:{studentKey:'student-b',score:99}}],['student-a']);
  assert.deepEqual(rows.map(row=>row.id),['a']);
});
