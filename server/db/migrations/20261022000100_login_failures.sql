create table if not exists public.login_failures (
  email text not null,
  ip_address text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (email, ip_address)
);

create index if not exists login_failures_email_idx on public.login_failures (email);
