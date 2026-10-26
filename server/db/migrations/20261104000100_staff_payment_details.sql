-- Migration: Add payment details (account holder, branch, upi_id, payment_mode) to staff_private
alter table if exists public.staff_private
  add column if not exists account_holder_name text,
  add column if not exists branch text,
  add column if not exists upi_id text,
  add column if not exists payment_mode text default 'both';

