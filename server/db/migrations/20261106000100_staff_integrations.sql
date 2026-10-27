create table if not exists public.staff_integrations (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  provider text not null check (provider in ('zoom', 'google_meet')),
  account_id text,
  client_id text,
  client_secret_encrypted text,
  zoom_user_email text,
  meeting_link text,
  status text not null default 'not_checked' check (status in ('not_checked', 'verified', 'failed')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id, provider)
);

create index if not exists staff_integrations_staff_idx on public.staff_integrations(staff_id);

