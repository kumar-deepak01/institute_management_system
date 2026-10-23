-- Finance records are stored as plain relational values. Existing fees/payments
-- remain the compatibility projection used by the Students and Dashboard pages.
create table if not exists public.fee_types (
  id text primary key,
  name text not null,
  component_group text not null default 'Other',
  badge_color text not null default 'blue',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_structures (
  id text primary key,
  title text not null,
  fee_type_id text,
  component_group text not null default 'Other',
  total_amount numeric(12,2) not null check (total_amount > 0),
  frequency text not null default 'one-time',
  academic_year_id text,
  scope text not null default 'global' check (scope in ('global','batch','student')),
  mandatory_enrollment boolean not null default false,
  due_date date,
  notes text not null default '',
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_structure_targets (
  id text primary key,
  structure_id text not null references public.fee_structures(id),
  batch_id text,
  student_key text,
  course_id text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(batch_id, student_key, course_id) = 1)
);

create table if not exists public.student_fees (
  id text primary key,
  student_key text not null,
  batch_id text,
  structure_id text,
  title text not null,
  fee_type_id text,
  total_amount numeric(12,2) not null check (total_amount >= 0),
  due_date date,
  status text not null default 'upcoming',
  installment_no integer,
  installment_count integer,
  discount_amount numeric(12,2) not null default 0,
  fine_amount numeric(12,2) not null default 0,
  waived_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fee_payments (
  id text primary key,
  student_fee_id text not null references public.student_fees(id),
  student_key text not null,
  amount numeric(12,2) not null check (amount >= 0),
  fine_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  method text not null,
  reference text not null default '',
  paid_at timestamptz not null default now(),
  receipt_no text not null unique,
  received_by text,
  idempotency_key text not null unique,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.fee_payment_deletions (
  id text primary key,
  payment_id text not null,
  student_fee_id text not null,
  student_key text not null,
  payment_snapshot jsonb not null,
  principal numeric(12,2) not null,
  net_reversed numeric(12,2) not null,
  fine_reversed numeric(12,2) not null default 0,
  deleted_by text not null,
  deleted_at timestamptz not null default now(),
  reason text not null
);

create table if not exists public.emi_plans (
  id text primary key,
  name text not null,
  installments integer not null check (installments between 2 and 60),
  interval_days integer not null check (interval_days between 1 and 365),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.emi_installments (
  id text primary key,
  student_fee_id text not null references public.student_fees(id),
  plan_id text references public.emi_plans(id),
  tranche_no integer not null,
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  collected numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (student_fee_id, tranche_no)
);

create table if not exists public.discounts (
  id text primary key,
  name text not null,
  code text not null unique,
  discount_type text not null check (discount_type in ('percent','flat')),
  value numeric(12,2) not null check (value > 0),
  applies_to text not null default 'all',
  valid_from date,
  valid_to date,
  usage_limit integer,
  used_count integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discount_redemptions (
  id text primary key,
  discount_id text not null references public.discounts(id),
  student_key text not null,
  student_fee_id text not null references public.student_fees(id),
  amount numeric(12,2) not null check (amount > 0),
  redeemed_by text,
  redeemed_at timestamptz not null default now()
);

create table if not exists public.late_fee_rules (
  id text primary key,
  name text not null,
  rule_type text not null check (rule_type in ('fixed','percent')),
  amount numeric(12,2) not null check (amount > 0),
  grace_days integer not null default 0 check (grace_days between 0 and 365),
  max_cap numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.late_fee_applications (
  id text primary key,
  rule_id text not null references public.late_fee_rules(id),
  student_fee_id text not null references public.student_fees(id),
  applied_on date not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (rule_id, student_fee_id, applied_on)
);

create table if not exists public.reminder_rules (
  id text primary key,
  name text not null,
  trigger text not null check (trigger in ('before_due','on_due','after_due')),
  days integer not null default 0 check (days between 0 and 365),
  send_time time not null default '09:00',
  channels jsonb not null default '["in_app"]'::jsonb,
  email_subject text not null default '',
  email_body text not null default '',
  sms_template text not null default '',
  whatsapp_template text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reminder_log (
  id text primary key,
  rule_id text,
  student_key text,
  channel text not null,
  status text not null,
  sent_at timestamptz not null default now(),
  detail text not null default ''
);

create table if not exists public.expense_heads (
  id text primary key,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id text primary key,
  head_id text,
  title text not null,
  amount numeric(12,2) not null check (amount > 0),
  spent_on date not null,
  method text not null,
  reference text not null default '',
  receipt_path text,
  receipt_name text,
  receipt_size bigint,
  receipt_mime text,
  notes text not null default '',
  recorded_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.income_heads (
  id text primary key,
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.income_records (
  id text primary key,
  title text not null,
  head_id text,
  amount numeric(12,2) not null check (amount > 0),
  received_on date not null,
  method text not null,
  reference text not null default '',
  receipt_path text,
  receipt_name text,
  receipt_size bigint,
  receipt_mime text,
  notes text not null default '',
  recorded_by text,
  created_at timestamptz not null default now()
);

create index if not exists fee_structures_active_scope_idx on public.fee_structures(active, scope, created_at desc);
create index if not exists fee_structure_targets_batch_idx on public.fee_structure_targets(batch_id, structure_id);
create index if not exists fee_structure_targets_student_idx on public.fee_structure_targets(student_key, structure_id);
create index if not exists student_fees_student_due_idx on public.student_fees(student_key, due_date, id);
create index if not exists student_fees_batch_due_idx on public.student_fees(batch_id, due_date, id);
create index if not exists student_fees_status_due_idx on public.student_fees(status, due_date);
create unique index if not exists student_fees_structure_student_uidx on public.student_fees(student_key, structure_id) where structure_id is not null;
create index if not exists fee_payments_student_paid_idx on public.fee_payments(student_key, paid_at desc);
create index if not exists fee_payments_fee_paid_idx on public.fee_payments(student_fee_id, paid_at desc);
create index if not exists fee_payments_active_paid_idx on public.fee_payments(paid_at desc) where reversed_at is null;
create index if not exists fee_payment_deletions_student_date_idx on public.fee_payment_deletions(student_key, deleted_at desc);
create index if not exists emi_installments_due_idx on public.emi_installments(due_date, student_fee_id);
create index if not exists discounts_active_validity_idx on public.discounts(active, valid_from, valid_to);
create index if not exists discount_redemptions_student_idx on public.discount_redemptions(student_key, redeemed_at desc);
create index if not exists late_fee_applications_fee_day_idx on public.late_fee_applications(student_fee_id, applied_on);
create index if not exists reminder_log_sent_idx on public.reminder_log(sent_at desc);
create index if not exists expenses_spent_on_idx on public.expenses(spent_on desc, id);
create index if not exists income_records_received_on_idx on public.income_records(received_on desc, id);

create or replace function public.prevent_fee_payment_deletion_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Fee payment deletion audit records are immutable';
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'fee_payment_deletions_immutable' and tgrelid = 'public.fee_payment_deletions'::regclass) then
    create trigger fee_payment_deletions_immutable before update or delete on public.fee_payment_deletions
      for each row execute function public.prevent_fee_payment_deletion_mutation();
  end if;
end $$;

insert into public.fee_types(id, name, component_group, badge_color) values
  ('tuition', 'Tuition', 'Academic', 'blue'),
  ('registration', 'Registration', 'Admission', 'violet'),
  ('exam', 'Exam', 'Academic', 'amber'),
  ('transport', 'Transport', 'Facilities', 'cyan'),
  ('hostel', 'Hostel', 'Facilities', 'emerald')
on conflict (id) do nothing;
