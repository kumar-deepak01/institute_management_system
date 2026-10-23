alter table public.attendance
  add column if not exists student_key text;

update public.attendance a
set student_key = coalesce(s.id, a.student_id)
from public.students s
where a.student_key is null
  and a.student_id is not null
  and a.student_id in (s.id, s.student_id);

create index if not exists attendance_batch_date_idx
  on public.attendance (batch_id, attendance_date);

create index if not exists attendance_student_key_date_idx
  on public.attendance (student_key, attendance_date);

create unique index if not exists attendance_batch_student_key_date_uidx
  on public.attendance (batch_id, student_key, attendance_date);

create index if not exists app_records_academic_status_idx
  on public.app_records (source_tab, (lower(coalesce(record_json->>'status', 'pending'))), created_at desc);
