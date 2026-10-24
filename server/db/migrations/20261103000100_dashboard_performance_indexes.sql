-- Performance optimization indexes for admin dashboard aggregated queries
create index if not exists students_status_idx on public.students (status);
create index if not exists fees_status_idx on public.fees (status);
create index if not exists admissions_applied_at_idx on public.admissions (applied_at desc);
create index if not exists assignments_due_date_idx on public.assignments (due_date);
