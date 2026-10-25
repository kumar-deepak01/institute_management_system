create table if not exists public.live_class_joins (
  id text primary key,
  class_id text not null,
  student_key text not null,
  batch_id text not null,
  subject_id text not null,
  attendance_date date not null,
  joined_at timestamptz not null default now(),
  status text not null default 'Present',
  record_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint live_class_joins_student_class_uniq unique (student_key, class_id)
);
create index if not exists live_class_joins_student_idx on public.live_class_joins (student_key, attendance_date);
create index if not exists live_class_joins_batch_idx on public.live_class_joins (batch_id, attendance_date);
create index if not exists live_class_joins_class_idx on public.live_class_joins (class_id);

