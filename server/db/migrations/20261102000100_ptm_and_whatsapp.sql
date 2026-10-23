create table if not exists public.ptm_sessions (
  id text primary key,
  title text not null,
  notes text not null default '',
  provider text not null check (provider in ('zoom','google_meet','in_person')),
  batch_id text not null,
  batch_name text not null,
  teacher_staff_id text not null,
  teacher_staff_key uuid not null,
  teacher_name text not null,
  audience text not null check (audience in ('parents','students_and_parents')),
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 10 and 240),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  provider_meeting_id text,
  join_url text,
  host_url text,
  provider_calendar_id text,
  created_by text not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ptm_sessions_batch_scheduled_idx
  on public.ptm_sessions (batch_id, scheduled_at desc);
create index if not exists ptm_sessions_teacher_scheduled_idx
  on public.ptm_sessions (teacher_staff_key, scheduled_at desc);
create index if not exists ptm_sessions_active_scheduled_idx
  on public.ptm_sessions (scheduled_at)
  where status = 'scheduled';

create table if not exists public.ptm_recipient_notices (
  id text primary key,
  session_id text not null references public.ptm_sessions(id) on delete cascade,
  recipient_account_id text not null references public.accounts(id) on delete cascade,
  recipient_role text not null check (recipient_role in ('student','parent','teacher')),
  student_key text,
  staff_key uuid,
  created_at timestamptz not null default now(),
  unique (session_id, recipient_account_id)
);

create index if not exists ptm_notices_recipient_created_idx
  on public.ptm_recipient_notices (recipient_account_id, created_at desc);
create index if not exists ptm_notices_session_idx
  on public.ptm_recipient_notices (session_id);

create table if not exists public.whatsapp_webhook_messages (
  message_id text primary key,
  received_at timestamptz not null default now()
);
create index if not exists whatsapp_webhook_received_at_idx
  on public.whatsapp_webhook_messages (received_at);
