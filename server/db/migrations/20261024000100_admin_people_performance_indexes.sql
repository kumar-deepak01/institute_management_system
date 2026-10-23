create index if not exists students_status_normalized_idx
  on public.students (lower(coalesce(status, '')));
create index if not exists students_name_sort_idx
  on public.students (name);
create index if not exists students_name_lower_idx
  on public.students (lower(name));
create index if not exists students_admission_number_sort_idx
  on public.students (coalesce(roll, student_id, id));
create index if not exists attendance_student_id_idx
  on public.attendance (student_id);
create index if not exists fees_student_id_idx
  on public.fees (student_id);
create index if not exists fees_status_normalized_idx
  on public.fees (lower(coalesce(status, '')));
create index if not exists payments_student_id_idx
  on public.payments (student_id);
create index if not exists staff_name_sort_idx
  on public.staff (name);
create index if not exists staff_status_normalized_idx
  on public.staff (lower(coalesce(status, 'active')));
create index if not exists staff_type_normalized_idx
  on public.staff (coalesce(staff_type, 'Teacher'));
