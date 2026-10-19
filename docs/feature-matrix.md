# Feature matrix

| Area | Current UI | Demo behavior | Status / limit |
|---|---|---|---|
| Public marketing | Homepage, feature catalogue, nav and CTAs | Responsive menu, cookie choice, pricing toggle, trial dialog, newsletter message | Implemented; external signup is not connected |
| Login | Common login and role chooser | Accepts empty inputs, toggles password visibility | Frontend-only; no identity check |
| Admin overview | Dashboard, statistics, charts and sidebar | Sample metrics and generic page/table views | Partial; many pages are generic |
| Admin people and CRM | Students, staff, admissions, leads | Sample rows, add/view dialogs | Partial; no data service |
| Admin curriculum | Years, courses, subjects, topics, batches, question bank | Sample records | Partial |
| Admin academic work | Timetable, attendance, homework, doubts, leave, online/offline exams, test series, reports, certificates, IDs | Shared tables and local form interactions where wired | Partial |
| Admin content and finance | Downloads, videos, live classes, fees, structures, discounts, reminders, audit/accounting, expenses/income, payroll/attendance | Generic sample records | Partial; no payment/HR integrations |
| Teacher portal | Dashboard, students, batches, timetable/upcoming classes, attendance, homework, exams, results, files, profile, leave, payslips, MAYA | Sample records, local attendance/review changes, sample downloads, rules-based assistant | Partial; no live AI or institute service |
| Student portal | Dashboard, courses, batch, schedule, live/video/materials, homework, exams, results, attendance, fees, certificates, notices, profile, support | Sample content and generic destination pages | Partial |
| Persistent data | Selected demo records | Browser local storage for students, homework, exams, and leave | Browser-local only; not a database |
| Backend | None | None | Missing |

See `implementation-audit.md` for evidence and test limits.
