alter table public.staff
  add column if not exists staff_key uuid,
  add column if not exists staff_type text not null default 'Teacher',
  add column if not exists qualification text,
  add column if not exists specialization text,
  add column if not exists experience_years numeric,
  add column if not exists joining_date date,
  add column if not exists bio text,
  add column if not exists employment_type text not null default 'Full-Time',
  add column if not exists monthly_salary numeric not null default 0,
  add column if not exists base_salary numeric not null default 0,
  add column if not exists per_class_rate numeric not null default 0,
  add column if not exists hourly_rate numeric not null default 0,
  add column if not exists pf_percent numeric not null default 12,
  add column if not exists tds_percent numeric not null default 0,
  add column if not exists branch_ids jsonb not null default '[]'::jsonb;

update public.staff set staff_key=gen_random_uuid() where staff_key is null;
alter table public.staff alter column staff_key set default gen_random_uuid();
alter table public.staff alter column staff_key set not null;

create unique index if not exists staff_staff_key_unique_idx on public.staff(staff_key);
create index if not exists staff_status_idx on public.staff(status);
create index if not exists staff_type_idx on public.staff(staff_type);
create index if not exists staff_employee_id_idx on public.staff(employee_id);
create index if not exists staff_email_lower_idx on public.staff(lower(email));
create index if not exists staff_name_lower_idx on public.staff(lower(name));

do $$
begin
  execute $index$create unique index if not exists staff_employee_id_unique_idx on public.staff(lower(employee_id)) where employee_id is not null and btrim(employee_id) <> ''$index$;
exception when unique_violation then
  raise warning 'Skipping unique index public.staff.employee_id: duplicate employee_id values exist';
end $$;

create table if not exists public.staff_private (
  staff_id text primary key references public.staff(id) on delete cascade,
  bank_account_number text,
  bank_name text,
  ifsc_code text,
  pan_number text,
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_subject_assignments (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  course_id text,
  subject_id text not null,
  batch_id text,
  created_at timestamptz not null default now(),
  unique(staff_id, course_id, subject_id, batch_id)
);
create index if not exists staff_subject_assignments_staff_idx
  on public.staff_subject_assignments(staff_id);
create index if not exists staff_subject_assignments_subject_idx
  on public.staff_subject_assignments(subject_id);
create index if not exists staff_subject_assignments_batch_idx
  on public.staff_subject_assignments(batch_id);

create table if not exists public.staff_email_changes (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  old_email text not null,
  new_email text not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index if not exists staff_email_changes_staff_idx
  on public.staff_email_changes(staff_id, changed_at desc);

create table if not exists public.staff_employee_counters (
  counter_name text primary key,
  next_value bigint not null check (next_value > 0),
  updated_at timestamptz not null default now()
);
insert into public.staff_employee_counters(counter_name, next_value)
select 'employee', coalesce(max((substring(employee_id from '([0-9]+)$'))::bigint), 0) + 1
from public.staff
on conflict(counter_name) do update
set next_value=greatest(public.staff_employee_counters.next_value, excluded.next_value), updated_at=now();
