-- Postgres becomes the canonical store for business records. app_records keeps
-- the legacy record shape losslessly during the API transition; typed columns
-- below are the queryable representation used for domain data.
create table if not exists public.app_records (
  source_tab text not null,
  record_id text not null,
  record_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_tab, record_id)
);

alter table public.students
  add column if not exists student_id text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists roll text,
  add column if not exists phone text,
  add column if not exists batch_id text,
  add column if not exists status text,
  add column if not exists joined_at timestamptz,
  add column if not exists record_json jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.staff
  add column if not exists employee_id text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists role text,
  add column if not exists status text,
  add column if not exists record_json jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.accounts (
  id text primary key, email text not null unique, role text not null,
  name text, student_id text, password_hash text not null, password_salt text not null,
  must_change_password boolean not null default false,
  record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.admissions (
  application_no text primary key, name text not null, gender text not null,
  date_of_birth date, batch_id text, batch_name text, mobile text not null, email text not null,
  address text, photo_path text, father_name text, mother_name text, guardian_phone text,
  previous_school text, previous_year_percent numeric,
  declaration_accepted_at timestamptz, status text not null, applied_at timestamptz not null,
  admin_notes text, reject_reason text, status_history jsonb not null default '[]'::jsonb,
  student_id text, record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.courses (
  id text primary key, name text, status text, record_json jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.batches (
  id text primary key, name text, course_id text, course_name text, active boolean,
  record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.attendance (
  id text primary key, student_id text, batch_id text, attendance_date date, status text,
  marked_by text, record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.fees (
  id text primary key, student_id text, description text, amount numeric, due_date date,
  status text, record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.payments (
  id text primary key, fee_id text, student_id text, amount numeric, paid_at timestamptz,
  status text, receipt_number text, record_json jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.payroll (
  id text primary key, employee_id text, amount numeric, paid_at timestamptz, status text,
  record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.assignments (
  id text primary key, title text, batch_id text, due_date date, status text, created_by text,
  record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.assignment_submissions (
  id text primary key, assignment_id text, student_id text, status text, submitted_at timestamptz,
  record_json jsonb not null, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.class_messages (
  id text primary key, body text not null, sent_by text, record_json jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.institute_settings (
  id text primary key, institute_name text, academic_year text, contact_email text, timezone text,
  config jsonb, record_json jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.trial_requests (
  id text primary key, name text not null, email text not null, institute_name text not null,
  phone text, created_at timestamptz not null default now()
);
create table if not exists public.newsletter_subscribers (
  id text primary key, email text not null unique, created_at timestamptz not null default now()
);
