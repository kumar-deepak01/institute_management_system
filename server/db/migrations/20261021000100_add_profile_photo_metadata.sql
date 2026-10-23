-- The application keeps student/staff records in Google Sheets. These small
-- Supabase rows hold only their stable IDs and profile-photo metadata.
create table if not exists public.students (
  id text primary key
);

create table if not exists public.staff (
  id text primary key
);

alter table public.students
  add column if not exists photo_path text,
  add column if not exists photo_updated_at timestamptz;

alter table public.staff
  add column if not exists photo_path text,
  add column if not exists photo_updated_at timestamptz;
