alter table public.live_classes
  add column if not exists provider_meeting_id text,
  add column if not exists host_url text,
  add column if not exists provider_calendar_id text;

create index if not exists live_classes_provider_meeting_idx
  on public.live_classes (provider, provider_meeting_id)
  where provider_meeting_id is not null;

create table if not exists public.integration_api_tokens (
  id text primary key,
  token_hash text not null unique,
  token_name text not null,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists integration_api_tokens_active_idx
  on public.integration_api_tokens (created_at desc)
  where revoked_at is null;

create table if not exists public.integration_events (
  id text primary key,
  provider text not null,
  event_type text not null,
  status text not null,
  http_status integer,
  actor_id text,
  created_at timestamptz not null default now()
);

create index if not exists integration_events_provider_created_idx
  on public.integration_events (provider, created_at desc);
