# Data model (proposed frontend demo)

This describes the in-browser sample model, not an observed Coach Sutra database.

## Current demo records

- Student: `name`, `initials`, `batch`, `roll`, `attendance`, `status`, `risk`, `score`.
- Homework: `title`, `batch`, `subject`, `due`, `submissions`, `status`.
- Exam: `title`, `batch`, `scheduled`, `marks`, `submissions`, `status`.
- Leave: form-created demo entries stored in browser local storage.
- Attendance: in-memory map from student identity to a status code for the current browser page.
- Assistant conversation: in-memory messages held only for the current page session.

## Storage

`portal.js` uses browser local storage keys prefixed with `cs-demo-` for selected demo records. Credentials are not read or stored. Other displayed figures and records are static sample data.

## Future backend model (proposal)

An eventual production system would need tenant/institute, user, role/permission, student, staff, course, subject, batch, timetable, attendance, homework/submission/review, exam/result, fee/payment/receipt, notification, and file/resource entities, with explicit tenant scoping and audit history. These are design proposals only; no schema or access policy has been reverse-engineered.

## Phase 1 Admin demo storage

The isolated Admin UI stores records as one JSON value under `cs-admin-demo-v1` in `localStorage`. It does not use the earlier shared `cs-demo-*` keys. The seed is synthetic. This browser-only shape is a prototype implementation, not evidence of the CoachSutra production schema.

Current local relationships:

- Courses and academic years are referenced by batches.
- Students reference their course, batch and academic year.
- Fees reference students; payments reference both a fee and student; payments carry a demo receipt number.
- Attendance entries reference a batch and date and contain student/status rows.
- Live classes store `title`, `topic`, `teacherId`, optional `subject` and `batchId`, `date`, `time`, `duration`, `platform`, optional `meetingUrl`, `daily`, `notes`, `status` and `createdAt`. The schedule and complete/delete status actions are local; recurring instances are not expanded.
- Homework, exams and question records are local module records; external delivery, grading and result workflows are not implemented.

Dashboard totals are computed from local fee/payment records. There is no API, authentication boundary, access-control model, cloud sync, payment ledger, audit log or real transaction semantics.
