-- Migration: 20261105000100_teacher_attendance.sql
-- Create teacher_class_joins table for automatic online attendance when teachers join Zoom classes

CREATE TABLE IF NOT EXISTS public.teacher_class_joins (
  id text PRIMARY KEY,
  class_id text NOT NULL,
  staff_id text NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  staff_key text,
  batch_id text,
  subject_id text,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  scheduled_time text,
  scheduled_start timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  duration_minutes integer DEFAULT 60,
  status text NOT NULL DEFAULT 'Present', -- 'Present' | 'Late'
  record_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teacher_class_joins_staff_class_date_uniq UNIQUE (staff_id, class_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_tcj_staff_date ON public.teacher_class_joins (staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_tcj_class ON public.teacher_class_joins (class_id);

