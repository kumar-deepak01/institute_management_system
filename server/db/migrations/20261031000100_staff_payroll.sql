create table if not exists public.payroll_runs (
  id text primary key,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft','approved','finalized','settled')),
  review_required boolean not null default false,
  review_reason text not null default '',
  generated_by text,
  approved_by text,
  approved_at timestamptz,
  finalized_by text,
  finalized_at timestamptz,
  settled_by text,
  settled_at timestamptz,
  payment_date date,
  payment_reference text,
  payment_method text,
  settled_amount numeric(14,2),
  gross_total numeric(14,2) not null default 0,
  deduction_total numeric(14,2) not null default 0,
  net_total numeric(14,2) not null default 0,
  record_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_start, period_end)
);

alter table public.payroll
  add column if not exists payroll_run_id text references public.payroll_runs(id),
  add column if not exists employee_key text references public.staff(id),
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists gross_pay numeric(14,2),
  add column if not exists deductions numeric(14,2),
  add column if not exists net_pay numeric(14,2),
  add column if not exists attendance_days numeric(8,2),
  add column if not exists payable_hours numeric(10,2),
  add column if not exists breakdown_json jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_json jsonb not null default '{}'::jsonb;

create unique index if not exists payroll_run_employee_uidx
  on public.payroll (payroll_run_id, employee_key)
  where payroll_run_id is not null and employee_key is not null;
create index if not exists payroll_period_status_idx
  on public.payroll (period_start desc, status);
create index if not exists payroll_runs_period_idx
  on public.payroll_runs (period_start desc, status);

create table if not exists public.staff_compensation_history (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  compensation_model text not null check (compensation_model in ('monthly','hourly','per_class','per_hour','hybrid')),
  monthly_rate numeric(14,2) not null default 0,
  hourly_rate numeric(14,2) not null default 0,
  class_rate numeric(14,2) not null default 0,
  teaching_hour_rate numeric(14,2) not null default 0,
  allowance numeric(14,2) not null default 0,
  effective_from date not null,
  effective_to date,
  attendance_policy jsonb not null default '{}'::jsonb,
  reason text not null default '',
  changed_by text,
  created_at timestamptz not null default now(),
  unique (staff_id, effective_from),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists staff_compensation_effective_idx
  on public.staff_compensation_history (staff_id, effective_from desc);

create table if not exists public.payroll_work_records (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  class_session_id text,
  work_date date not null,
  record_kind text not null check (record_kind in ('attendance','teaching','hourly')),
  source text not null default 'manual',
  verification_status text not null default 'pending' check (verification_status in ('pending','verified','ambiguous','unavailable')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','completed','cancelled','rescheduled','no_show')),
  minutes integer not null default 0 check (minutes >= 0),
  payable_minutes integer not null default 0 check (payable_minutes >= 0),
  provider_meeting_id text,
  provider_event_id text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  record_json jsonb not null default '{}'::jsonb,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, provider_event_id)
);
create index if not exists payroll_work_staff_period_idx
  on public.payroll_work_records (staff_id, work_date, record_kind, status);
create unique index if not exists payroll_work_class_session_staff_uidx
  on public.payroll_work_records (class_session_id, staff_id)
  where class_session_id is not null;
create unique index if not exists payroll_staff_daily_attendance_uidx
  on public.payroll_work_records (staff_id, work_date)
  where record_kind = 'attendance' and source = 'manual';

create table if not exists public.payroll_zoom_events (
  id text primary key,
  provider_event_id text not null unique,
  meeting_id text not null,
  meeting_uuid text,
  event_type text not null,
  event_json jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'pending' check (processing_status in ('pending','processed','report_pending','ambiguous','failed'))
);
create index if not exists payroll_zoom_events_meeting_idx
  on public.payroll_zoom_events (meeting_id, received_at desc);

create table if not exists public.payroll_adjustments (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  kind text not null check (kind in ('earning','deduction')),
  label text not null,
  amount numeric(14,2) not null check (amount >= 0),
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by text,
  approved_by text,
  approved_at timestamptz,
  payroll_id text references public.payroll(id),
  created_at timestamptz not null default now()
);
create index if not exists payroll_adjustments_staff_period_idx
  on public.payroll_adjustments (staff_id, period_start, status);

create table if not exists public.payroll_advances (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  repayment_amount numeric(14,2) not null default 0 check (repayment_amount >= 0),
  reason text not null,
  requested_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending','approved','cancelled','closed')),
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists payroll_advances_staff_status_idx
  on public.payroll_advances (staff_id, status, requested_date desc);

create table if not exists public.payroll_advance_repayments (
  id text primary key,
  advance_id text not null references public.payroll_advances(id),
  payroll_id text not null references public.payroll(id),
  period_start date not null,
  amount numeric(14,2) not null check (amount > 0),
  created_by text,
  created_at timestamptz not null default now(),
  unique (advance_id, payroll_id)
);

create table if not exists public.payroll_audit_events (
  id text primary key,
  actor_id text,
  staff_id text references public.staff(id) on delete set null,
  payroll_run_id text references public.payroll_runs(id) on delete set null,
  event_type text not null,
  reason text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists payroll_audit_created_idx
  on public.payroll_audit_events (created_at desc);
