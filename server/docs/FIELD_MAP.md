# Frontend field-to-database map

Postgres is the target and runtime source of truth. The one-time importer is `npm run migrate:sheets`. It reads the legacy Google Sheets tabs; runtime API writes go to Postgres. `app_records.record_json` preserves the full API record and typed columns below are projected for queries. The JSON version of this map is [FIELD_MAP.json](FIELD_MAP.json).

## Admission form

Endpoint: `POST /api/admissions/submit`. The controller validates required name, gender, batch, 10-digit mobile, email, and declaration; previous-year percentage must be 0–100. This route currently uses controller validation rather than Zod. Imported and new values are saved to `app_records` and typed `admissions` columns.

| Frontend field | Request key | Validation | PostgreSQL column |
| --- | --- | --- | --- |
| Full name | `name` | Required, cleaned, 2–160 chars | `admissions.name` |
| Gender | `gender` | Required: Male, Female, Other | `admissions.gender` |
| Date of birth | `dateOfBirth` | Optional date text | `admissions.date_of_birth` |
| Course/batch | `batchId` | Required active configured batch | `admissions.batch_id` |
| Mobile | `mobile` | Required, normalized 10 digits | `admissions.mobile` |
| Email | `email` | Required email format, normalized lowercase | `admissions.email` |
| Address | `address` | Optional, cleaned, <=1000 chars | `admissions.address` |
| Applicant photo | `photo` | Optional base64 image, up to 5 MB | `admissions.photo_path` (path only) |
| Father/mother | `fatherName`, `motherName` | Optional, cleaned | `admissions.father_name`, `admissions.mother_name` |
| Guardian phone | `guardianPhone` | Optional digits, max 10 | `admissions.guardian_phone` |
| Previous school | `previousSchool` | Optional, cleaned | `admissions.previous_school` |
| Previous year percentage | `previousYearPercent` | Optional numeric, 0–100 | `admissions.previous_year_percent` |
| Declaration | `declaration` | Must be `true`; server timestamps acceptance | `admissions.declaration_accepted_at` |

Admin status route `POST /api/admissions/admin/:applicationNo` stores `status`, `adminNotes`, `rejectReason`, generated student ID, and server-generated `statusHistory` in `admissions` and the full JSON record.

## Student, staff, and authentication

Student `POST /api/students` fields `name`, `email`, `roll`, `phone`, `batchId`, generated `id`, `status`, and `joinedAt` map to `students.name`, `.email`, `.roll`, `.phone`, `.batch_id`, `.id`, `.status`, `.joined_at`. Staff `POST /api/staff` fields `employeeId`, `name`, `email`, `phone`, `role`, `status`, and `id` map to the corresponding `staff` columns. These generic CRUD routes validate record objects and exclude image/base64 properties; the complete payload is retained in `app_records`.

Student/staff photo route parameters are validated by Zod (`type` enum and constrained ID). Multer caps the incoming file at 200 KB; MIME and file bytes must be JPEG/PNG/WebP; Sharp resizes/compresses to WebP <=50 KB. The object path is stored only in `students.photo_path` or `staff.photo_path`, with timestamp in `photo_updated_at`. See [DATABASE_AUDIT.md](DATABASE_AUDIT.md).

Auth forms use `POST /api/auth/login`, `/forgot`, `/verify-otp`, `/reset-password`, and `/change-password`. Email and password fields are validated in the controller; only password hash and salt go into `accounts.password_hash` / `password_salt`. OTP challenge data stays ephemeral in process memory.

## Other submitted UI forms

| UI fields | Endpoint | Validation | PostgreSQL target |
| --- | --- | --- | --- |
| Trial name, email, institute, phone | `POST /api/trial-requests` | Controller: required cleaned name/institute, email format, optional phone format | `trial_requests.name`, `.email`, `.institute_name`, `.phone` |
| Newsletter email | `POST /api/newsletter` | Controller: email format, lowercase | `newsletter_subscribers.email` |
| Admin attendance date, student ID, status | `POST /api/attendance` | Admin generic record validation; full payload retained | `attendance.attendance_date`, `.student_id`, `.status` |
| Teacher attendance date, roll, status | `POST /api/teacher/attendance` | Teacher session + CSRF; date and P/A/L/E status checked | `attendance.attendance_date`, `.student_id`, `.status` |
| Assignment title, batch, due date | `POST /api/teacher/assignments` | Teacher session + CSRF; required title/batch/date | `assignments.title`, `.batch_id`, `.due_date` |
| Assignment submission | `POST /api/student/assignment-submissions` | Student session + CSRF; student ID comes from account | `assignment_submissions.assignment_id`, `.student_id`, `.status` |
| Class message | `POST /api/teacher/messages` | Teacher session + CSRF; nonempty body, <=4000 chars | `class_messages.body` |
| Institute name, year, contact email, timezone | `PUT /api/settings` | Admin session + CSRF; all fields required, email format | `institute_settings` matching columns |

Fees, payments, courses, and batches currently have no corresponding entry forms on the client; their existing admin record APIs still store their submitted records in typed tables and `app_records`. No branch page, form, or API exists, so no branch table has been invented. Search/filter controls, tabs, cookie preferences, and static demo cards do not submit business records.
