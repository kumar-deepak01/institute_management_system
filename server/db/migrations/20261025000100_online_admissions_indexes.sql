create index if not exists admissions_applied_at_idx
  on public.admissions (applied_at desc);
create index if not exists admissions_batch_applied_idx
  on public.admissions (batch_id, applied_at desc);
create index if not exists admissions_mobile_batch_status_idx
  on public.admissions (mobile, batch_id, status);
create index if not exists admissions_email_lower_idx
  on public.admissions (lower(email));
create index if not exists admissions_name_lower_idx
  on public.admissions (lower(name));
