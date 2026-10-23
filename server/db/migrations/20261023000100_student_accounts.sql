alter table public.accounts
  add column if not exists must_change_password boolean not null default false,
  add column if not exists session_version integer not null default 0;

create table if not exists public.password_resets (
  id text primary key,
  account_id text not null references public.accounts(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now()
);

create index if not exists password_resets_account_created_idx
  on public.password_resets (account_id, created_at desc);
create index if not exists students_email_idx on public.students (lower(email));
create index if not exists students_batch_id_idx on public.students (batch_id);
create unique index if not exists accounts_email_lower_unique_idx on public.accounts (lower(email));

create table if not exists public.student_email_changes (
  id text primary key,
  student_id text not null references public.students(id) on delete cascade,
  old_email text not null,
  new_email text not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);
create index if not exists student_email_changes_student_idx
  on public.student_email_changes (student_id, changed_at desc);
