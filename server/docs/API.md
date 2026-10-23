# API reference

All API responses use JSON. Login sessions use the `cs_session` HttpOnly cookie. Admin routes accept an admin session or `X-Admission-Admin-Token`. PostgreSQL must be configured and the business-data migration applied before data-backed routes can operate.

| Method | URL | Request | Success response |
| --- | --- | --- | --- |
| GET | `/health` | — | `200 { "ok": true }` |
| GET | `/api/admissions/admin/token` | — | `{ "token": "…" }` |
| GET | `/api/admissions/public/config` | — | `{ open, instituteName, academicYear }` |
| GET | `/api/admissions/public/batches` | — | Array of `{ id, name, course }` |
| POST | `/api/admissions/submit` | `{ name, gender, dateOfBirth, batchId, mobile, email, address, fatherName, motherName, guardianPhone, previousSchool, previousYearPercent, declaration: true, photo? }` | `201 { ok, applicationNo, mobile, email }` |
| POST | `/api/trial-requests` | `{ name, email, instituteName, phone? }` | `201 { ok: true }` |
| POST | `/api/newsletter` | `{ email }` | `200 { ok: true }` |
| GET | `/api/admissions/admin/list` | Admin session or admin token header | `{ applications: [...] }` |
| POST | `/api/admissions/admin/config` | Admin auth; `{ open, academicYear, batches? }` | `{ ok: true }` |
| POST | `/api/admissions/admin/:applicationNo` | Admin auth; `{ status, adminNotes?, rejectReason?, student? }` (`student.id` is required to approve) | `{ ok: true, application }` |
| POST | `/api/auth/register` | `{ name, email, studentId, parentEmail?, parentName? }`; creates initial-password accounts | `201 { ok, rollbackToken }` |
| POST | `/api/auth/rollback` | `{ rollbackToken }` | `{ ok: true }` |
| POST | `/api/auth/login` | `{ email, password }` | `{ ok: true, account }` and session cookie |
| GET | `/api/auth/me` | Session cookie | `{ account }` |
| POST | `/api/auth/logout` | Session cookie | `{ ok: true }` and cleared cookie |
| POST | `/api/auth/first-otp` | Session cookie; empty JSON body | `{ challengeId, expiresIn, demoMode?, demoOtp? }` |
| POST | `/api/auth/forgot` | `{ email }` | Generic message and challenge details |
| POST | `/api/auth/verify-otp` | `{ challengeId, code }` | `{ ok: true }` |
| POST | `/api/auth/change-password` | Session cookie; `{ challengeId, password, confirmPassword }` after first-login OTP verification | `{ ok: true, account }` |
| POST | `/api/auth/reset-password` | `{ challengeId, password, confirmPassword }` | `{ ok: true }` |
| GET | `/api/auth/csrf` | Signed-in session cookie | `{ csrfToken }` |
| GET | `/api/photos/:type/:id` | Signed-in cookie; own student photo or authorized admin/teacher | `{ photo_url }` (10-minute signed URL with cache version) |
| POST | `/api/photos/students/:id` | Cookie, `X-CSRF-Token`, multipart `photo` (JPEG/PNG/WebP, <=200 KB incoming) | `{ ok, photo_path, photo_updated_at, photo_url, size }` (stored WebP <=50 KB) |
| POST | `/api/photos/staff/:id` | Same upload requirements and authorization | Same upload response |
| DELETE | `/api/photos/:type/:id` | Cookie, `X-CSRF-Token`; admin or matching teacher | `{ ok, photo_path: null, photo_updated_at: null }` |
| GET | `/api/teacher/assignments` | Teacher/admin session cookie | `{ assignments: [...] }` |
| POST | `/api/teacher/assignments` | Teacher/admin cookie, CSRF; `{ title, batch, batchId, due }` | `201 { assignment }` |
| GET | `/api/teacher/attendance` | Teacher/admin session cookie | `{ records: [...] }` |
| POST | `/api/teacher/attendance` | Teacher/admin cookie, CSRF; `{ records: [{ date, roll, status }] }` | `{ records: [...] }` |
| POST | `/api/teacher/messages` | Teacher/admin cookie, CSRF; `{ body }` | `201 { message }` |
| POST | `/api/student/assignment-submissions` | Student cookie, CSRF; `{ assignmentId }` | `{ submission }` |
| GET | `/api/student/assignment-submissions` | Student session cookie | `{ submissions: [...] }` |
| GET / PUT | `/api/settings` | Admin session; PUT also requires CSRF | `{ settings }` / `{ ok, settings }` |
| GET | `/api/{students,staff,payroll,courses,batches,attendance,fees,payments}` | Admin auth | `{ records: [...] }` |
| POST | `/api/{collection}` | Admin auth; `{ record }`, `{ records }`, or one record | `201 { records: [...] }` |
| PUT | `/api/{collection}/:id` | Admin auth; replacement object or `{ record }` | `{ record }` |
| DELETE | `/api/{collection}/:id` | Admin auth | `{ ok: true }` |

Data collection names: `students`, `staff`, `payroll`, `courses`, `batches`, `attendance`, `fees`, and `payments`. Student/staff profile responses use `getPhotoUrl` for private signed URLs. Common error statuses are 400 (invalid input), 401 (authentication), 403 (authorization/CSRF), 404 (missing route/record), 409 (duplicate), 413 (size), 415 (unsupported file), 429 (rate limit), and 503 (storage/configuration unavailable). Route dispatch is in `src/routes/`; endpoint behavior is in `src/controllers/apiController.js` and `src/routes/photos.js`.
