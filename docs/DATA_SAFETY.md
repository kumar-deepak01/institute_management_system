# Database & Data Safety Guide

## 1. Architecture & Table Responsibilities

| Table Name | Category | Description | Safety Rule |
|---|---|---|---|
| `public.accounts` | **Core Auth** | Primary home for all user credentials (admin, teacher, student, parent). Contains `id`, `email`, `role`, `password_hash`, `password_salt`, `session_version`. | **PROTECTED**. Never truncate or delete. Admin accounts can NEVER be deleted. |
| `public.schema_migrations` | **System** | Tracks executed database migrations. | **PROTECTED**. Never delete. |
| `public.institute_settings` | **System** | Institute configuration, academic year, branding. | **PROTECTED**. Never delete. |
| `public.courses` | **Curriculum** | Academic courses offered by institute. | **PROTECTED**. Core structure. |
| `public.batches` | **Curriculum** | Batches under courses. | **PROTECTED**. Core structure. |
| `public.subjects` | **Curriculum** | Subjects assigned to courses/batches. | **PROTECTED**. Core structure. |
| `public.topics` | **Curriculum** | Syllabus topics under subjects. | **PROTECTED**. Core structure. |
| `public.academic_years` | **Curriculum** | Academic year sessions. | **PROTECTED**. Core structure. |
| `public.fee_types` | **Finance** | Master fee heads/types. | **PROTECTED**. Core structure. |
| `public.fee_structures` | **Finance** | Fee allocation structures. | **PROTECTED**. Core structure. |
| `public.students` | Business Data | Student profile records. | Can be wiped during test data cleanup. Linked student accounts in `accounts` table are deleted when student is deleted. |
| `public.staff` | Business Data | Staff and faculty profiles. | Can be wiped during test data cleanup (except admin). |
| `public.staff_private` | Business Data | Banking & UPI payout information. | Wiped when staff is deleted. |
| `public.admissions` | Business Data | Admission leads and applications. | Can be wiped during test data cleanup. |
| `public.attendance` | Business Data | Class attendance records. | Can be wiped during test data cleanup. |
| `public.fees` & `payments` | Business Data | Invoices and payment receipts. | Can be wiped during test data cleanup. |
| `public.app_records` | Legacy Mirror | Key-value store previously used as Google Sheets mirror. | Legacy only. Auth **NO LONGER** depends on `app_records(source_tab='Students')`. |
| `public.login_failures` | Security | Rate limiting and IP lockout for login attempts. | Ephemeral. Entries can be safely cleared to unlock locked users. |
| `public.password_resets` | Security | OTP tokens for forgot-password requests. | Ephemeral. Expired entries automatically pruned. |

---

## 2. Cleanup & Test Data Rules

When cleaning test data before production launch:
1. **Never wipe Protected Tables**:
   - `accounts` (holds admin & authorized logins)
   - `schema_migrations`, `institute_settings`
   - `courses`, `batches`, `subjects`, `topics`, `academic_years`, `fee_types`, `fee_structures`
2. **Admin Protection**:
   - Admin account (`role = 'admin'`) has code guards preventing deletion or role modification in `apiController`, `studentController`, and `staffController`.
   - Never run `DELETE FROM accounts;`. If removing test student/teacher accounts, only target specific roles or IDs:
     ```sql
     DELETE FROM public.accounts WHERE role <> 'admin';
     ```
3. **Always take a backup first**:
   - Save a full database dump before running any data manipulation scripts.

---

## 3. How to Reset Admin Password

If the admin password is forgotten or needs to be updated:

```bash
# From the project root:
node server/scripts/reset-admin-password.js <admin_email> "<new_password_min_10_chars>"

# Example:
node server/scripts/reset-admin-password.js dk2612005@gmail.com "SecurePass2026!"
```

What the script does:
1. Validates password length (>= 10 characters).
2. Generates a fresh cryptographic salt.
3. Computes PBKDF2 (SHA-256, 310,000 iterations) hash.
4. Updates `public.accounts` table with new hash, salt, and increments `session_version` (revoking old sessions).
5. Clears any lockouts from `public.login_failures`.
6. Prints `Done`.

