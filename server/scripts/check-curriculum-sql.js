const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { Client } = require('pg');
const { buildListSql, entities, statsSql, lookupQueries } = require('../src/controllers/curriculumController');

const safeCode = error => String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
const safeMessage = error => String(error?.message || 'Unknown database error')
  .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted connection string]')
  .replace(/\b(database_url|password|passwd|hash|cookie|authorization|secret|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
  .replace(/[\r\n\t]+/g, ' ').slice(0, 300);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('ERROR connect code=DATABASE_NOT_CONFIGURED message=DATABASE_URL is not configured');
    process.exitCode=1;
    return;
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000, query_timeout: 12000 });
  const cases=[];
  for(const entity of Object.keys(entities))cases.push([`${entity} list`,buildListSql(entity,'smoke','active','sample-parent','sample-year',1,10)]);
  cases.push(['stats',{sql:statsSql,values:[]}]);
  for(const [name,sql] of Object.entries(lookupQueries))cases.push([`${name} lookup`,{sql,values:[]}]);
  for(const [name,config] of Object.entries(entities)){
    cases.push([`${name} detail`,{sql:`select * from public.${config.table} where id=$1`,values:['sample-id']}]);
    cases.push([`${name} duplicate check`,{sql:`select 1 from public.${config.table} where lower(name)=lower($1) and id<>$2 ${name==='batches'?"and course_id=$3 and coalesce(record_json->>'academicYearId','')=$4":''} limit 1`,values:name==='batches'?['Sample','sample-id','sample-course','sample-year']:['Sample','sample-id']}]);
  }
  cases.push(['subject duplicate check',{sql:"select 1 from public.subjects where lower(name)=lower($1) and id<>$2 and coalesce(course_id,'')=coalesce(nullif($3,''),'') limit 1",values:['Sample','sample-id','sample-course']}]);
  cases.push(['topic duplicate check',{sql:"select 1 from public.topics where lower(name)=lower($1) and id<>$2 and coalesce(subject_id,'')=coalesce(nullif($3,''),'') limit 1",values:['Sample','sample-id','sample-subject']}]);
  cases.push(['course relation check',{sql:'select 1 from public.courses where id=$1',values:['sample-course']}]);
  cases.push(['subject relation check',{sql:'select 1 from public.subjects where id=$1',values:['sample-subject']}]);
  cases.push(['active course relation check',{sql:"select 1 from public.courses where id=$1 and coalesce(status,'active') not in ('inactive','archived')",values:['sample-course']}]);
  cases.push(['academic year relation check',{sql:"select 1 from public.academic_years where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')",values:['sample-year']}]);
  cases.push(['active subject relation check',{sql:"select 1 from public.subjects where id=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')",values:['sample-subject']}]);
  cases.push(['active teacher relation check',{sql:"select 1 from public.staff where id=$1 and coalesce(staff_type,'Teacher')='Teacher' and lower(coalesce(status,'active')) not in ('inactive','archived')",values:['sample-teacher']}]);
  cases.push(['batch course and teacher lookup',{sql:'select c.name as course_name,s.name as teacher_name from public.courses c left join public.staff s on s.id=$2 where c.id=$1',values:['sample-course','sample-teacher']}]);
  try {
    await client.connect();
    await client.query('begin read only');
    for(let index=0;index<cases.length;index+=1){
      const [name,query]=cases[index],savepoint=`curriculum_sql_${index+1}`;
      await client.query(`savepoint ${savepoint}`);
      try{await client.query(query.sql,query.values);console.log(`OK ${name}`);}
      catch(error){console.log(`ERROR ${name} code=${safeCode(error)} message=${safeMessage(error)}`);process.exitCode=1;await client.query(`rollback to savepoint ${savepoint}`);}
      finally{await client.query(`release savepoint ${savepoint}`);}
    }
    await client.query('rollback');
  }catch(error){
    console.log(`ERROR connect code=${safeCode(error)} message=${safeMessage(error)}`);process.exitCode=1;
    try{await client.query('rollback');}catch{/* no open transaction */}
  }finally{await client.end().catch(()=>{});}
}
main().catch(error=>{console.log(`ERROR check code=${safeCode(error)} message=${safeMessage(error)}`);process.exitCode=1;});
