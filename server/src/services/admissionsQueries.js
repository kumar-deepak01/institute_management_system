const admissionsListSql = `with filtered as (
  select a.application_no,a.name,a.gender,a.date_of_birth,a.batch_id,a.batch_name,a.mobile,a.email,a.address,a.photo_path,
    a.father_name,a.mother_name,a.guardian_phone,a.previous_school,a.previous_year_percent,a.declaration_accepted_at,
    a.status,a.applied_at,a.admin_notes,a.reject_reason,a.status_history,a.student_id,a.record_json
  from public.admissions a
  where ($1::text='' or a.application_no ilike '%'||$1||'%' or a.name ilike '%'||$1||'%' or a.email ilike '%'||$1||'%' or a.mobile ilike '%'||$1||'%')
    and ($2::text='' or a.status=$2)
    and ($3::text='' or a.batch_id=$3)
), page as (
  select * from filtered order by applied_at desc,application_no desc limit $4 offset $5
)
select coalesce(jsonb_agg(to_jsonb(page) order by page.applied_at desc,page.application_no desc),'[]'::jsonb) as records,
  (select count(*)::int from filtered) as total
from page`;

const admissionsStatsSql = `select count(*)::int as total,
  count(*) filter(where status='Pending')::int as pending,
  count(*) filter(where status='Under Review')::int as under_review,
  count(*) filter(where status='Approved')::int as approved,
  count(*) filter(where status='Rejected')::int as rejected
from public.admissions`;

const admissionsBatchesSql = `select b.id,b.name,coalesce(b.course_name,c.name,'') as course
from public.batches b left join public.courses c on c.id=b.course_id
where coalesce(b.active,true)=true order by b.name,b.id`;

const admissionsConfigSql = `select institute_name,academic_year,coalesce(config,'{}'::jsonb) as config
from public.institute_settings where id='institute-settings' limit 1`;

function buildAdmissionsListQuery(search='', status='', batchId='', page=1, limit=10) {
  return { sql: admissionsListSql, values: [search, status, batchId, limit, (page-1)*limit] };
}

module.exports = { admissionsListSql, admissionsStatsSql, admissionsBatchesSql, admissionsConfigSql, buildAdmissionsListQuery };
