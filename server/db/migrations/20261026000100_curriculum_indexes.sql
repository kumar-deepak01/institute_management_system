-- Supporting indexes for curriculum filters, duplicate checks, and name search.
-- Existing tables and columns are reused without alteration.
create index if not exists academic_years_status_updated_idx
  on public.academic_years (lower(coalesce(status, 'active')), updated_at desc);
create index if not exists academic_years_name_prefix_idx
  on public.academic_years (lower(name) text_pattern_ops);

create index if not exists courses_status_updated_idx
  on public.courses (lower(coalesce(status, 'active')), updated_at desc);
create index if not exists courses_name_prefix_idx
  on public.courses (lower(name) text_pattern_ops);

create index if not exists subjects_course_status_updated_idx
  on public.subjects (course_id, lower(coalesce(status, 'active')), updated_at desc);
create index if not exists subjects_name_prefix_idx
  on public.subjects (lower(name) text_pattern_ops);

create index if not exists topics_subject_status_updated_idx
  on public.topics (subject_id, lower(coalesce(status, 'active')), updated_at desc);
create index if not exists topics_name_prefix_idx
  on public.topics (lower(name) text_pattern_ops);

create index if not exists batches_course_active_updated_idx
  on public.batches (course_id, active, updated_at desc);
create index if not exists batches_academic_year_idx
  on public.batches ((record_json->>'academicYearId'));
create index if not exists batches_name_prefix_idx
  on public.batches (lower(name) text_pattern_ops);

create index if not exists students_batch_id_idx
  on public.students (batch_id);
