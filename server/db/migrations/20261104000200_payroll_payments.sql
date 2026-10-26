-- Migration: 20261104000200_payroll_payments.sql
-- Create payroll_payments table for tracking salary disbursements, UTR numbers and receipt generation

CREATE TABLE IF NOT EXISTS public.payroll_payments (
  id text PRIMARY KEY,
  payroll_id text NOT NULL REFERENCES public.payroll(id) ON DELETE CASCADE,
  payroll_run_id text REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
  receipt_no text UNIQUE NOT NULL,
  staff_id text NOT NULL,
  staff_name text,
  employee_id text,
  payment_method text NOT NULL, -- 'Bank Transfer' | 'UPI'
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL,
  transaction_id text NOT NULL,
  account_holder_name text,
  bank_name text,
  account_number_masked text,
  ifsc_code text,
  branch text,
  upi_id text,
  remarks text,
  paid_by text,
  status text NOT NULL DEFAULT 'completed', -- 'completed' | 'cancelled'
  snapshot_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_payments_payroll_id ON public.payroll_payments(payroll_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_staff_id ON public.payroll_payments(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_payments_receipt_no ON public.payroll_payments(receipt_no);

