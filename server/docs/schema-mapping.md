# Schema mapping

This inventory is based on the checked-in SQL migrations. No database connection or query was made. `record_json` is the lossless record payload used by the existing PostgreSQL store; typed columns support filtering and reporting.

## Existing tables and columns

| Table | Columns from migrations |
|---|---|
| `public.students` | `id`, `photo_path`, `photo_updated_at`, `student_id`, `name`, `email`, `roll`, `phone`, `batch_id`, `status`, `joined_at`, `record_json`, `created_at`, `updated_at` |
| `public.staff` | `id`, `photo_path`, `photo_updated_at`, `employee_id`, `name`, `email`, `phone`, `role`, `status`, `record_json`, `created_at`, `updated_at` |
| `public.app_records` | `source_tab`, `record_id`, `record_json`, `created_at`, `updated_at` |
| `public.accounts` | `id`, `email`, `role`, `name`, `student_id`, `password_hash`, `password_salt`, `must_change_password`, `record_json`, `created_at`, `updated_at` |
| `public.admissions` | `application_no`, `name`, `gender`, `date_of_birth`, `batch_id`, `batch_name`, `mobile`, `email`, `address`, `photo_path`, `father_name`, `mother_name`, `guardian_phone`, `previous_school`, `previous_year_percent`, `declaration_accepted_at`, `status`, `applied_at`, `admin_notes`, `reject_reason`, `status_history`, `student_id`, `record_json`, `created_at`, `updated_at` |
| `public.courses` | `id`, `name`, `status`, `record_json`, `created_at`, `updated_at` |
| `public.batches` | `id`, `name`, `course_id`, `course_name`, `active`, `record_json`, `created_at`, `updated_at` |
| `public.attendance` | `id`, `student_id`, `batch_id`, `attendance_date`, `status`, `marked_by`, `record_json`, `created_at`, `updated_at` |
| `public.fees` | `id`, `student_id`, `description`, `amount`, `due_date`, `status`, `record_json`, `created_at`, `updated_at` |
| `public.payments` | `id`, `fee_id`, `student_id`, `amount`, `paid_at`, `status`, `receipt_number`, `record_json`, `created_at`, `updated_at` |
| `public.payroll` | `id`, `employee_id`, `amount`, `paid_at`, `status`, `record_json`, `created_at`, `updated_at` |
| `public.assignments` | `id`, `title`, `batch_id`, `due_date`, `status`, `created_by`, `record_json`, `created_at`, `updated_at` |
| `public.assignment_submissions` | `id`, `assignment_id`, `student_id`, `status`, `submitted_at`, `record_json`, `created_at`, `updated_at` |
| `public.class_messages` | `id`, `body`, `sent_by`, `record_json`, `created_at` |
| `public.institute_settings` | `id`, `institute_name`, `academic_year`, `contact_email`, `timezone`, `config`, `record_json`, `updated_at` |
| `public.trial_requests` | `id`, `name`, `email`, `institute_name`, `phone`, `created_at` |
| `public.newsletter_subscribers` | `id`, `email`, `created_at` |
| `public.login_failures` | `email`, `ip_address`, `failed_attempts`, `locked_until`, `updated_at` |

## Feature storage map

| Inventory feature | Existing / added storage | Notes |
|---|---|---|
| Dashboard and enrollment trend | `students.joined_at`, `students.status` | Counts and monthly trend are queried from PostgreSQL. |
| Fee collection overview | `payments.amount`, `payments.paid_at`, `payments.status`; `fees` | Collections use payment rows with a paid timestamp. |
| Attendance overview | `attendance.attendance_date`, `attendance.status` | Daily totals come from persisted attendance rows. |
| Student directory and profile | `students`, `accounts`, `admissions` | Existing tables; no new student table. |
| Courses and batches | `courses`, `batches` | Existing tables cover these curriculum records. |
| Academic years | `academic_years` (added) | Needed by the upcoming Academic Years page. |
| Subjects and topics | `subjects`, `topics` (added) | Needed by upcoming Curriculum pages; both retain the existing JSON record pattern. |
| Homework | `assignments`, `assignment_submissions` | Existing tables cover upcoming Homework page. |
| Staff and payroll | `staff`, `payroll` | Existing tables cover inventory records. |
| Online Admissions application, review, status history and approval link | `admissions` (`application_no`, applicant fields, `status`, `status_history`, `student_id`, `photo_path`, `record_json`) plus `app_records` (`source_tab='Admissions'`) | Existing storage reused. Approval calls the shared student creation helper and writes the linked student and admission status in one transaction. |
| Public admission form batch options | `batches`, `courses` | Existing active batch/course rows; no placeholder/demo batches. |
| Admission open/closed switch and public institute details | `institute_settings` (`config`, `institute_name`, `academic_year`, `record_json`) | Existing settings row and JSON config reused; no new columns. |
| Admission applicant photos | Existing Supabase private photo bucket; `admissions.photo_path`, then `students.photo_path` on approval | Image bytes stay in storage; only a path is stored in PostgreSQL. |
| Broadcast / class communication | `class_messages` | Existing table supports saved class messages; delivery integrations remain unverified. |
| Reports | Existing domain tables above | Report screens will be scoped to supported persisted data. |
| Lead CRM and other unverified inventory features | No table added | No verified storage requirements were established for these pages. |

## Additive migration

`20261022000200_admin_dashboard_foundation.sql` follows the login-failures migration. It creates only `academic_years`, `subjects`, and `topics`, all with `CREATE TABLE IF NOT EXISTS`, plus indexes with `CREATE INDEX IF NOT EXISTS`. It does not alter or remove existing columns or tables.

## Students module (2026-10-23)

- Student profile columns remain in `public.students`; optional profile details, guardian fields, assigned subject IDs, and admission number are preserved in `students.record_json` and the matching `public.app_records` row (`source_tab='Students'`, `record_id=student id`).
- Login accounts use `public.accounts` and matching `public.app_records` account rows. `must_change_password` marks default-password accounts; `session_version` lets password reset invalidate existing signed sessions without changing cookie attributes.
- Student batch/course and subject lookup reads `public.batches`, `public.courses`, and `public.subjects`. Attendance summaries read `public.attendance`; fee status reads `public.fees` (payments are retained separately and are not treated as fee records).
- Password reset codes use `public.password_resets`, storing only the OTP hash, expiry, used time, and attempt count.
- Migration `20261023000100_student_accounts.sql` uses additive, idempotent alterations and indexes; no existing table or column is dropped, renamed, or truncated.
- Admin-only login email edits are recorded in `public.student_email_changes`; the student profile and linked account are updated in one transaction and prior sessions are invalidated through `session_version`.
## Staff module (2026-10-23)

| Feature | Existing storage reused | Additive storage in `20261023000200_staff_module.sql` |
|---|---|---|
| Staff identity, contact, role, status, and profile photo | `public.staff` (`id`, `employee_id`, `name`, `email`, `phone`, `role`, `status`, `record_json`, `photo_path`, `photo_updated_at`) | Adds `staff_key` (backfilled UUID), `staff_type`, qualification, specialization, experience, joining date, bio, employment type, pay rates, deductions, and `branch_ids`. |
| Staff login | `public.accounts` and `public.app_records` (`source_tab='Students'`, `_type='account'`) | No new account table. Staff accounts use the existing `teacher` role and carry `staffId`/`employeeId`; staff type stays on the staff profile. Non-admin staff are never assigned `admin`. |
| Payroll history | `public.payroll` (`employee_id`, `amount`, `paid_at`, `status`, `record_json`) | No duplicate payroll table. |
| Today's classes | `public.app_records` rows under `Timetable` or `Schedule`, using date/classDate/startDate JSON values | No timetable table added. A missing timetable source produces zero. |
| Branches | `public.app_records` (`source_tab='Branches'`) when present | No branch table added because an existing verified branch schema was not found. Staff can be saved with no branches. |
| Subject/course/batch assignments | `public.courses`, `public.subjects`, and `public.batches` | Adds `public.staff_subject_assignments` with staff/course/subject/batch IDs. |
| Payroll bank data | No existing dedicated staff banking structure found | Adds admin-only `public.staff_private`; list/profile payloads mask account and PAN values, and export includes them only after explicit opt-in. |
| Staff email change audit | No existing staff-specific email audit table found | Adds `public.staff_email_changes`. |
| Employee ID allocation | No existing staff counter found | Adds `public.staff_employee_counters`, seeded from existing numeric employee ID suffixes. |
| Staff attendance | Existing `public.app_records` rows (`Staff Attendance` or `StaffAttendance`) if present | No duplicate attendance table added; absent source yields a clean empty state. |

The migration uses additive/idempotent DDL and does not rename or remove existing schema. The optional unique employee ID index is skipped with a warning if existing duplicates prevent it. The staff list uses one parameterized aggregate query for rows, counts, type counts, payroll total, and today's class count; profile detail uses two bounded queries in parallel for attendance and payroll. `public.staff` indexes support status, type, employee ID, email, name, and stable key lookups. The 15-second stats cache is invalidated on staff mutations.

## Curriculum module (2026-10-26)

| Feature | Existing storage reused | Module 2 behavior |
|---|---|---|
| Academic years | `public.academic_years` and mirrored `public.app_records` (`source_tab='Academic Years'`) | Create, edit, activate/deactivate/archive, date range, SQL search and pagination. |
| Courses | `public.courses` and mirrored `public.app_records` (`source_tab='Courses'`) | Create, edit, status, duration and description in `record_json`; course renames refresh existing batch labels. |
| Subjects | `public.subjects` and mirrored `public.app_records` (`source_tab='Subjects'`) | Course relationship uses `course_id`; existing Student and Staff lookup response shapes are unchanged. |
| Topics | `public.topics` and mirrored `public.app_records` (`source_tab='Topics'`) | Subject relationship uses `subject_id`. |
| Batches | `public.batches` and mirrored `public.app_records` (`source_tab='Batches'`) | Course relation remains `course_id`; academic year, teacher, schedule and dates use existing `record_json`, while `active` and `course_name` remain available to existing lookups. |

`20261026000100_curriculum_indexes.sql` contains only `CREATE INDEX IF NOT EXISTS` statements. It supports name prefix/duplicate checks, normalized status filters, parent filters, ordering, batch student counts and the batch academic-year JSON filter. No table or column is added, removed, renamed or truncated. Admin list queries return the requested page and total in one query; the stats endpoint uses one scalar-count query; curriculum lookups use five independent queries limited by the shared three-query concurrency helper and a 12-second in-memory cache. All curriculum caches are invalidated after writes. Existing `/api/admin/students/lookups` and `/api/admin/staff/lookups` routes and shapes are not changed.

## Online Admissions module (2026-10-25)

- Public applications and admin review use the existing `public.admissions` table. `public.app_records` mirrors each application for compatibility with the established record store.
- Batch options come from `public.batches` joined to `public.courses`; the admin switch and institute/year labels use the existing `public.institute_settings.config` JSON field.
- Approval reuses the Students module's `createStudent` flow inside the same database transaction, records `admissions.student_id`, and updates both record JSON rows. A matching existing student can be linked after the admin confirms the match.
- Applicant image bytes are processed and stored in the existing private Supabase photo bucket. PostgreSQL stores only the path in `admissions.photo_path`; approval copies the object to the student's photo path and stores that path on the student record.
- No new table or column was needed. `20261025000100_online_admissions_indexes.sql` adds only idempotent indexes for application date, batch/date, duplicate mobile checks, and normalized name/email lookup.

## Academics Part B (2026-10-27)

- Homework uses existing `public.assignments` and `public.assignment_submissions`. Subject ID, stable student key, and staff key stay in `assignments.record_json`; the existing typed `batch_id`, due date, status, and creator columns remain populated. A student key maps to the existing `students.id`; the schema does not define a separate `student_key` column.
- Doubts use `public.app_records` with `source_tab='Doubts'`; records link the same student key (`students.id`), `staff.staff_key`, `batches.id`, and `subjects.id`. No dedicated doubts table or new column was needed.
- `20261027000100_academics_part_b_indexes.sql` adds only `CREATE INDEX IF NOT EXISTS` indexes for assignment ordering/filtering, submission status, and app-record source ordering.
- Each list is one parameterized SQL query with the total count and pagination; stats and combined form lookups are each one SQL query. Stats and lookup responses are cached in memory for 12 seconds and invalidated on module writes. There are no per-record follow-up queries.

## Academics Part A and Doubts monitoring (2026-10-28)

- Attendance reuses `public.attendance` and `public.students`; the one additive column `attendance.student_key` is backfilled by matching the existing `student_id` against `students.id` or `students.student_id`. New marks store `students.id` in both `attendance.student_id` (preserving the existing Dashboard/Students readers) and `attendance.student_key`. The migration adds indexes for batch/date, student/date, and uniqueness for batch/student/date upserts. Holiday and approved leave state remains in existing `public.app_records` rows (`Holidays`, `Leave Requests`) and is derived at attendance read time; those statuses are not inserted as attendance marks.
- Timetable classes, teacher availability, holidays, and approved staff leave use `public.app_records` under `Timetable`, `Teacher Availability`, `Holidays`, and `Leave Requests`. Class references are `batchId` -> `batches.id`, `subjectId` -> `subjects.id`, `staffKey` -> `staff.staff_key`; substitutes are stored as dated entries in the same class record JSON.
- Leave requests, attendance regularizations, holidays, leave types, and balances use `public.app_records` under their corresponding source tabs. Request relationships use stable `studentKey` / `staffKey`; balances store `personKey` and `typeId`. No new leave, timetable, or doubt tables were created.
- Doubts monitoring and the student/teacher portal-ready endpoints use `public.app_records` (`source_tab='Doubts'`) with `studentKey` -> `students.id`, `staffKey` -> `staff.staff_key`, `batchId` -> `batches.id`, and `subjectId` -> `subjects.id`. Existing `assignments` and `assignment_submissions` remain the Homework storage and code path.
- Migration `20261028000100_academics_part_a.sql` adds only `attendance.student_key` and idempotent indexes. It does not create a duplicate attendance table, or alter, rename, or remove existing tables or columns.
- Attendance roster/date load is one aggregate SQL statement; saving changed attendance is one `INSERT ... SELECT FROM unnest(...) ON CONFLICT` statement inside a transaction. Report is one paginated query. Lookups are one aggregate query. Timetable weekly data and its holiday/leave/availability arrays are one SQL statement. Leave list/stats and lookups are each one statement. Doubt list/stats and lookups are each one statement. These paths use the shared pool and bounded query helper; lookup/list responses are cached in memory for 12 seconds and writes invalidate caches.
# Content & Media additions (migration 20261029000100)

| Feature | Storage | Notes |
| --- | --- | --- |
| Download Center records | `public.download_items` | Typed metadata; subject references reuse `public.subjects` IDs. |
| Download attachments | `public.download_attachments` | Stores UUID-based private object paths and file metadata only. Signed URLs are created on demand. |
| Video Lectures | `public.video_lectures` | References existing `public.batches` and `public.subjects`; video object paths stay private. External URLs are supported. |
| Video watch progress | `public.video_watch_progress` | Unique row per `(video_id, student_key)` for watch/completion state. |
| Live Classes | `public.live_classes` | Links existing `public.staff.staff_key`, `public.subjects.id`, and `public.batches.id`. Providers are stored as keys, without third-party branding. |
| Provider integrations | `public.integration_connections` | Provider credentials are encrypted server-side; status endpoint exposes only connected booleans. |

The migration is additive and uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Existing curriculum, student, staff, and admissions tables are reused and left unchanged.

## Finance additions (migration `20261030000100_finance_module.sql`)

| Finance data | Storage | Existing relationships / compatibility |
| --- | --- | --- |
| Fee type catalog and reusable structures | `public.fee_types`, `public.fee_structures`, `public.fee_structure_targets` | Structures reference the existing `academic_years`, `courses`, `batches`, and `students` IDs without changing those tables. |
| Student fee obligations and receipts | `public.student_fees`, `public.fee_payments` | Student and batch keys point to existing rows. New obligations and payments are also projected to the existing `public.fees`, `public.payments`, and `public.app_records` storage read by Dashboard and Students. |
| Payment reversals | `public.fee_payment_deletions` | Original payment is marked reversed; an immutable snapshot and reason are appended for audit. |
| EMI plans and installments | `public.emi_plans`, `public.emi_installments` | Installments reference a student fee; exact cents are distributed with the remainder assigned to the final installment. |
| Discounts and redemptions | `public.discounts`, `public.discount_redemptions` | Redemptions link to existing student and Finance fee keys. |
| Late fees and reminders | `public.late_fee_rules`, `public.late_fee_applications`, `public.reminder_rules`, `public.reminder_log` | Applications and reminder records retain the affected fee/student keys. External message channels remain unavailable until separately configured. |
| Expense and income entries | `public.expense_heads`, `public.expenses`, `public.income_heads`, `public.income_records` | Amounts, descriptions, references, and dates are stored as typed database values. Receipt metadata columns store an object path and file metadata only; no file bytes or base64 are stored in PostgreSQL. |

The Finance migration is additive: it creates Finance-owned tables and indexes only. It does not alter existing tables, columns, or migrations.

Private objects use the existing Supabase Storage client. `SUPABASE_CONTENT_BUCKET` optionally chooses the bucket; if blank, the configured profile photo bucket is used. `INTEGRATIONS_ENCRYPTION_KEY` must be a base64-encoded 32-byte key before saving Zoom or Teams credentials. Neither variable needs to be added to `server/.env` by this change.
