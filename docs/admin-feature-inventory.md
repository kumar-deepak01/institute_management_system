# CoachSutra Admin feature inventory from video

This inventory uses the supplied recording only. **Observed** means the page/control is visible in sampled frames. **Partial** means the UI is visible but its exact fields or outcomes are not. **Not established** means the recording does not demonstrate the workflow. Do not elevate an item to production behavior based on labels alone.

| Area | Video evidence | Visible controls/content | Evidence status |
|---|---|---|---|
| Admin shell and navigation | 00:00–31:18, all sheets | Left navigation, top global search and utility icons, page workspace, floating assistant/help affordance | Observed shell; destinations vary in coverage |
| Dashboard and analytics | 09:36–09:48 (`sheet-07`) | Institute greeting/context, KPI cards, quick actions, Student Enrollment Trend, fee/revenue overview and other panels | Page observed; values/formulas unknown |
| Students directory | 00:00–00:18; 06:06–06:24 (`sheet-01`, `sheet-04`, `sheet-05`) | Summary counts, student table, admission number/batch/subjects/attendance/fees/risk columns, search/actions including import/export/bulk update/admit | Observed; bulk/import/export execution not demonstrated |
| Student admission | 03:12–06:06 (`sheet-03`–`sheet-04`) | Long form sections: personal information, academic details, parent/guardian details, photo; save and visible success/list update | Create transition observed; exact schema/validation partial |
| Student profile | 06:24–08:00 (`sheet-05`–`sheet-06`) | Student details and attendance/fee summaries; fee assignment entry point | Partial; exact profile tabs/fields unknown |
| Courses/programs | 00:24–01:18 (`sheet-01`) | Course/program master and add form/dialog | Page/form observed; field list and save outcome unknown |
| Batches | 01:24–03:06 (`sheet-02`) | Batch list/empty state and Create New Batch form | Page/form observed; exact linking fields and successful save uncertain |
| Fee assignment | 06:48 onward (`sheet-06`) | Assign Fee to Student action/form; fee information appears in student/payment context | Partial; fee structure and recurrence rules unknown |
| Payment collection and receipt | Approximately 08:00–08:54 (`sheet-06`) | Payments/history, Collect Payment dialog and print/receipt view | Sequence observed; gateway, payment status and exact fields unknown |
| Leads/CRM | 09:54–11:06 (`sheet-07`–`sheet-08`) | Lead list, filters/status controls, Add Lead entry point and empty state | Page observed; CRUD outcomes unknown |
| Meta Lead Ads integration | 11:12–12:42 (`sheet-08`) | Integration/configuration page | Page observed; credentials, consent and connection state unknown |
| Lead nurturing automation | 13:00–14:12 (`sheet-09`) | Summary counters, filters and empty state/Create First Sequence | Page observed; sequence editor/execution not observed |
| Smart Billing Hub | 15:30–16:12 (`sheet-10`) | Finance summary cards and billing/collection workspace | Partial; precise values and accounting rules unknown |
| Live class scheduling | 16:18–18:12 (`sheet-11`–`sheet-12`) | Schedule Live Class form, option cards, class-detail inputs and date picker | Form observed; provider/link generation and publish outcome unknown |
| Staff record creation | 18:18–20:00 (`sheet-12`–`sheet-14`) | Account information, profile/photo region, employment type options (Full-Time, Contractual, Part-Time, Hourly), compensation/employment sections | Form observed; exact field constraints and save transition uncertain |
| Staff directory/profile | 20:00–23:30 (`sheet-14`–`sheet-15`) | Staff summary cards, search/filter, person card/detail view and multiple profile sections/tabs | Page observed; tab labels and editing outcomes partly illegible |
| Payroll/staff attendance | 20:00–23:30 and 23:36–25:18 (`sheet-14`–`sheet-16`) | Payroll/attendance-like profile areas and payroll/performance reports | Partial hints only; no payroll run, salary settlement, payslip issue or staff attendance action confirmed |
| Reports & Analytics | 23:36–25:18 (`sheet-15`–`sheet-16`) | Report catalogue; legible categories include student progress/data, attendance, fee collection, top performers, student performance, staff/teacher performance, payroll, admission, exam, payment/transaction, income/expense | Catalogue observed; report results/exports and filters not demonstrated |
| Parent-teacher meeting | 25:24–25:48 (`sheet-16`–`sheet-17`) | Schedule PTM Session form and teacher selection area | Form observed; booking/notification state unknown |
| Bulk communication | 25:54–27:06 (`sheet-17`–`sheet-18`) | Composer, audience/recipient selector, channel/recipient options, title/body, delivery options and recent messages panel | Composer observed; send outcome and channels not confirmed |
| Messages/inbox | 27:12–27:36 (`sheet-18`) | Conversation list, conversation pane, reply input and send control | UI observed; delivery/read state unknown |
| Test series | 28:00–28:06 (`sheet-18`) | Summary cards, empty state and create action | Page observed; setup/attempt/results workflow not shown |
| Exam creation | 28:06–30:42 (`sheet-18`–`sheet-20`) | Online vs Offline/Paper mode choice, exam details, schedule/marks-like inputs, advanced settings, date picker, red error banner | Form and validation state observed; successful create, grading and result publication not shown |
| Question bank | 28:48–29:00 (`sheet-19`) | Empty state, search/filter and add/import entry points | Page observed; question editor/import workflow not clear |
| Homework & assignments | 30:48–31:00 (`sheet-20`) | Summary cards, search/filter, empty state and Assign Homework action | Page observed; assignment creation/review/submission not shown |
| Attendance | 31:06–31:12 (`sheet-20`) | Date/batch-like controls, summary cards, status filters and record tile | Page observed; mark/save outcome and rules unknown |
| Academic years | 31:12–31:20 (`sheet-20`) | Empty state and Create First Year action | Page observed; creation form/rollover behavior not shown |

## Modules not proven by this recording

Certificates, ID cards, expenses/income entry, discount/coupon setup, late-fee rules, payment reminders, learning material upload/library, video lectures, result release/report cards, exam grading, student transfer/promotion, staff leave approval, salary processing/payslip publication, settings/permissions, deletion audit, and biometric integrations are not sufficiently demonstrated in the sampled video. Some may exist elsewhere in the product; this inventory does not claim they are absent from the website.

## Implementation status in this project (read-only source inspection)

Project files inspected: `admin.html`, `portal.html`, `portal.js`, `portal.css`, `app.js`, `feature-matrix.md`, `data-model.md`, and the existing implementation audit. No source file was changed during this analysis.

| Area | Current project status | Evidence in existing implementation |
|---|---|---|
| Admin entry/shell/dashboard | Partial demo | `admin.html` selects shared `portal.js`; admin role has a sample dashboard with hard-coded metrics/charts and common shell. |
| Students | Partial demo | Sample table and add-student dialog; only selected demo records use browser storage. Video’s detailed admission/profile/fee flow is not equivalent. |
| Staff | Generic demo page | Shared generic table and add/view dialog; no full staff employment/payroll lifecycle. |
| Course/program | Generic demo page | Sample rows; not the observed course master workflow. |
| Batch | Generic demo page | Sample rows; no complete batch creation/assignment flow. |
| Admissions/CRM | Generic demo page | Online admissions and leads use generic sample table renderer, not video-specific lead stages/integration. |
| Fees/billing/payments | Generic demo page | Fee collection sample table; no assignment, collection, receipt, gateway, ledger or billing workflow. |
| Reports | Generic demo page/sample dashboard | Sample report rows and charts; not the observed report catalogue/data pipeline. |
| Live classes | Generic demo page | No complete scheduling/publishing/provider flow. |
| PTM and communications | Generic demo page | No audience composer/inbox delivery workflow. |
| Exams/test series/question bank | Partial/generic | Exam table and local create/delete behavior exist; test series/question bank are generic. No observed-form fidelity or grading workflow. |
| Homework/attendance | Partial demo | Shared homework and attendance pages have limited local demo interactions; no institute-connected state. |
| Academic years | Generic demo | Sample academic-year rows; no creation or rollover workflow. |
| Payroll/staff attendance | Generic demo | Generic tables only; no salary calculation or payslip publishing. |
| Backend/auth/integrations | Missing | Static HTML/CSS/JS only; no server, database, payment processor, Meta, mail/SMS/WhatsApp or live-video integration. |

For exact current project limits see [`implementation-audit.md`](implementation-audit.md). The matrix is a source inspection, not a runtime test.

## Phase 1 UI implementation status (2026-10-19)

`admin.html` now loads the isolated Admin implementation in `admin-app.js` and `admin-app.css`. The Admin entry no longer loads `portal.js`; Teacher, Student, login and public entries retain their existing script references.

Implemented as local browser-demo flows:

- Dashboard overview, finance summary, setup banner, shortcut actions, enrollment-period toggle, recent transactions/leads, birthday, exam, risk and homework panels.
- Academic years, course/program records, batches, student admission/profile, fee assignment, payment recording and printable demo receipts. Student → course/batch/year, fee → student, payment → fee/student and receipt → payment links are stored locally.
- Staff, Lead CRM, Meta integration checklist preview, nurturing draft, live-class schedule and management page, PTM, communication preview/inbox, question bank, test series, exam setup, homework assignment, attendance marking, timetable and local report catalogue.
- Directory search/filter and CSV export are present where applicable. Form constraints and relationship checks are handled locally.

The only new storage key is `cs-admin-demo-v1`; existing `cs-demo-*` role data is not read, migrated, cleared or overwritten. Seed data is synthetic and visibly labeled as local demo data. No charge, message, video meeting, integration, payroll calculation, exam grading, result publication, or hosted service is performed. Results, expenses, payroll, certificates, ID cards, library and learning materials display explicit deferred states.

Verification: `node --check admin-app.js`, `portal.js`, and `student-portal.js` passed; static HTTP requests for `admin.html`, `index.html`, `login.html`, `teacher.html`, and `student.html` returned 200. REA controlled browser capture and direct headless Chrome startup did not complete in this Windows session (Chrome process startup reports access denied; REA capture remained pending and was stopped). Therefore click-through, screenshot comparison, mobile viewport, validation/receipt interaction, and regression behavior remain unverified in a real browser.

### Live Classes page update (2026-10-19)

The Admin sidebar's **Live Classes** destination now has the reference-inspired dashboard and opens the scheduling dialog from its page buttons. The page includes Live Now / Upcoming / Completed counts and filters, supported platform chips, the Zoom/Teams setup guide, an empty state, and saved class cards with Join, Edit, Mark completed, and Delete actions. The dialog includes Jitsi, Zoom, Google Meet, Teams, and Custom Link options; title, topic, teacher, subject, batch, date, time, duration, URL, and daily recurrence fields. Saved schedules and status changes remain local to `cs-admin-demo-v1`. URL links are limited to HTTP(S).

Provider creation, credentials, auto-generated meeting URLs, participant invitations, and actual daily recurrence are not connected. For this UI-only phase, users create a provider meeting separately, paste its URL into the dialog, and open that saved URL with Join class. The dialog offers guidance instead of collecting API keys. Browser visual and click-through verification was not performed for this update.
