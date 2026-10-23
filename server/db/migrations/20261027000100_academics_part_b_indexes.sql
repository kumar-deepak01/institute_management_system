create index if not exists assignments_created_at_idx
  on public.assignments (created_at desc);

create index if not exists assignments_status_created_at_idx
  on public.assignments ((lower(coalesce(status, 'assigned'))), created_at desc);

create index if not exists assignment_submissions_status_idx
  on public.assignment_submissions ((lower(coalesce(status, ''))));

create index if not exists app_records_source_created_at_idx
  on public.app_records (source_tab, created_at desc);
