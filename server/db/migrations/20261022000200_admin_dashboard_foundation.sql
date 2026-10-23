-- Add only the curriculum records needed by the next admin modules.
create table if not exists public.academic_years (
  id text primary key,
  name text not null,
  start_date date,
  end_date date,
  status text,
  record_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id text primary key,
  course_id text,
  name text not null,
  status text,
  record_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id text primary key,
  subject_id text,
  name text not null,
  status text,
  record_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists students_joined_at_idx on public.students (joined_at);
create index if not exists attendance_date_idx on public.attendance (attendance_date);
create index if not exists payments_paid_at_idx on public.payments (paid_at);
create index if not exists admissions_status_idx on public.admissions (status);
create index if not exists subjects_course_id_idx on public.subjects (course_id);
create index if not exists topics_subject_id_idx on public.topics (subject_id);
