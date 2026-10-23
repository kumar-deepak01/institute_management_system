create table if not exists public.download_items (
  id text primary key,
  title text not null,
  description text,
  content_type text not null,
  subject_id text,
  subject_name text,
  access_permission text not null default 'view_download',
  external_url text,
  status text not null default 'draft',
  publish_at timestamptz,
  expires_at timestamptz,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.download_attachments (
  id text primary key,
  download_id text not null,
  storage_path text not null,
  original_name text not null,
  content_type text not null,
  file_size bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists public.video_lectures (
  id text primary key,
  title text not null,
  description text,
  batch_id text,
  subject_id text,
  chapter text,
  topic text,
  external_url text,
  storage_path text,
  content_type text,
  file_size bigint,
  unlock_at timestamptz,
  status text not null default 'published',
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_watch_progress (
  id text primary key,
  video_id text not null,
  student_key text not null,
  watched_seconds integer not null default 0,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint video_watch_progress_video_student_unique unique (video_id, student_key)
);

create table if not exists public.live_classes (
  id text primary key,
  title text not null,
  topic text,
  provider text not null,
  teacher_key text not null,
  subject_id text,
  batch_id text,
  scheduled_at timestamptz not null,
  duration_minutes integer not null default 60,
  recurring_daily boolean not null default false,
  meeting_url text,
  notes text,
  status text not null default 'scheduled',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_connections (
  id text primary key,
  provider text not null unique,
  credentials_encrypted text not null,
  connected boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists download_items_status_created_idx on public.download_items (lower(status), created_at desc);
create index if not exists download_items_subject_idx on public.download_items (subject_id, status);
create index if not exists download_items_content_type_idx on public.download_items (content_type, status, created_at desc);
create index if not exists download_items_title_lower_idx on public.download_items (lower(title));
create index if not exists download_attachments_download_idx on public.download_attachments (download_id);
create index if not exists video_lectures_status_created_idx on public.video_lectures (lower(status), created_at desc);
create index if not exists video_lectures_batch_subject_idx on public.video_lectures (batch_id, subject_id);
create index if not exists video_lectures_title_lower_idx on public.video_lectures (lower(title));
create index if not exists video_watch_progress_student_idx on public.video_watch_progress (student_key, video_id);
create index if not exists live_classes_scheduled_idx on public.live_classes (lower(status), scheduled_at);
create index if not exists live_classes_batch_idx on public.live_classes (batch_id, scheduled_at);
