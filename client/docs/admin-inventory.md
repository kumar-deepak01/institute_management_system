# My JEE Mentor Admin Portal Inventory

This inventory is based on the supplied Coach Sutra screen recording, the existing analysis and contact sheets in `old-html/docs/`, and a new local frame extraction. It records visible screens and controls only; a visible button or form does not establish a working server workflow.

## Recording analysis method and limits

- Recording: `choch_sutra.mp4`, H.264, 1918×1182, approximately 31 minutes 20 seconds.
- REA was available and used to inspect the existing React application source (Evidence `ev_ae50982fe5d66e2f6c7b6559ee8fea3e6415c118156602a6b26f22a5d1624beb`). Its JavaScript application analyzer does not accept video, and the active REA tools expose no video decode, frame extraction, or per-frame video analysis operation.
- Following the supplied prompt's fallback, ffmpeg extracted 627 frames at three-second intervals and 670 additional one-second frames around documented screen, modal, dropdown, form and date-picker transitions. Contact sheets were reviewed to track the recording. They are visual review aids; they do not make small text reliably legible.
- Google Meet overlays are recording artifacts and are excluded from the target design.
- Existing six-second analysis is retained at `old-html/docs/admin-video-analysis.md`; its 20 contact sheets are retained under `old-html/docs/admin-video-frames/`.
- Evidence establishes screen appearance and demonstrated transitions only. Backend behavior, database persistence, authorization, third-party integrations and business calculations remain unverified unless explicitly stated below.

## Sidebar inventory

| Group | Item | Evidence in recording | Status |
|---|---|---|---|
| Overview | Dashboard | Institute welcome/setup banner, KPI cards, quick actions, enrollment trend, finance and operational panels | Observed; metric definitions and values unverified |
| Overview | Academic Years | Empty state and create action | Implemented in Module 2 with create, edit, activate/archive and date fields; rollover remains out of scope |
| Overview | Reports | Report catalogue and a fee collection report view | Observed; filters, calculations and exports partly unverified |
| People | Students | Summary cards, searchable directory, status/batch-like filters, row actions, import/export/bulk actions | Observed; most action outcomes unverified |
| People | Student admission | Personal, academic, guardian and photo sections; save toast and directory update | Create transition observed; exact validation and persistence unverified |
| People | Student profile | Profile summary, attendance calendar, fee/payment history, assignment and collection dialogs, printable receipt | UI sequence observed; payment processing and receipt rules unverified |
| People | Staff | Directory, add-staff form, employment type cards, profile and sections/tabs | Observed; exact fields and save effects partly unverified |
| People | Online Admissions | Listed in the broader admin menu/spec; admin review, public link, filters, status history, notes and approval flow are implemented from the old admin prototype | Implemented in Module 1; exact video layout remains unverified |
| Curriculum | Courses | Course/program master, create dialog and a resulting course card | Implemented in Module 2 with database-backed create, edit, status and search |
| Curriculum | Subjects | Present in the broader menu/spec; no distinct workflow confirmed | Implemented in Module 2 with course assignment, status and search; exact reference workflow remains unverified |
| Curriculum | Topics | Present in the broader menu/spec; no distinct workflow confirmed | Implemented in Module 2 with subject assignment, status and search; exact reference workflow remains unverified |
| Curriculum | Batches | Empty state, create form, course/teacher-like selectors, date picker and resulting batch card | Implemented in Module 2 with course/year assignment, date fields, status and search; teacher assignment was not established by the available schema |
| Curriculum | Question Bank | Search/filter row, empty state, add/import actions | Page observed; question editing/import unverified |
| Academics | Timetable | Weekly Mon-Sun grid, batch/teacher filters, class types, class modal, substitutes, availability, matrix and print control | Implemented in Academics Part A using `app_records`; scheduling conflicts and availability warnings are database-backed. Exact visual parity and real record shape still require manual review. |
| Academics | Attendance | Date/batch controls, status summaries, bulk marking, holiday state, student cards and report/export actions | Implemented in Academics Part A using the existing `attendance` table and an additive `student_key`; Dashboard and Students continue reading the same table. Exact visual parity and report calculations require manual review. |
| Academics | Homework | Summary cards, filters, empty state and assignment dialog | Implemented in Academics Part B using existing assignments and assignment_submissions; no file or notification workflow was shown |
| Academics | Doubts | Student Q&A monitor with subject/teacher/status filters and a reply thread | Implemented in Academics Part A using existing `app_records`; student and teacher endpoints are prepared for portal integration. |
| Academics | Leave & Holidays | Pending/approved requests, role/status filters, holiday list, leave types, balances, and attendance regularizations | Implemented in Academics Part A using existing `app_records`; approval for a regularization updates the matching attendance row. Exact visual parity and input record conventions require manual review. |
| Exams & Results | Online Exams | Exam catalogue and create form with online exam option, settings, date picker and validation banner | Form/validation state observed; successful creation and grading unverified |
| Exams & Results | Offline Exams | Offline/paper option in the exam creation flow | Option observed; separate workflow unverified |
| Exams & Results | Test Series | Summary cards and empty state/create action | Page observed; setup, attempts and results unverified |
| Exams & Results | Report Cards | Report catalogue references report cards; a complete report-card workflow is not shown | Partial / unverified |
| Exams & Results | Certificates, ID Cards, Proctoring | Menu items in the older prototype/spec; no video workflow confirmed | Unverified |
| Content & Media | Download Center / Learning Materials | Listed in the broader menu only | Unverified |
| Content & Media | Video Lectures | Listed in the broader menu only | Unverified |
| Content & Media | Live Classes | Empty list, status summaries/filters, schedule dialog with platform choices and class fields | Page and form observed; provider integration and publishing unverified |
| Finance | Fee Collection | Student-linked fee assignment and fee/payment history | UI flow observed; fee policy and persistence unverified |
| Finance | Payment Collection / Receipt | Collect Payment dialog followed by print/receipt view | UI flow observed; gateway, settlement and receipt numbering unverified |
| Finance | Smart Billing Hub | Financial summary cards, billing/collection workspace, rows and filters | Page observed; calculations and transaction semantics unverified |
| Finance | Fee Structures, Discounts, Late Fee Rules, Payment Reminders, Deletion Audit, Accounting Export, Payment History | Present in the broader menu/spec; no complete distinct workflows confirmed | Unverified, except payment-history content visible in student context |
| Finance | Expenses, Income, Expense/Income Heads | Menu items or report categories; no verified entry workflow | Unverified |
| HR & Staff | Payroll / Payslips | Payroll-like staff profile sections and report cards are visible | Partial; no payroll run or payslip issue is demonstrated |
| HR & Staff | Staff Attendance | Not demonstrated as a distinct workflow | Unverified |
| HR & Staff | Biometric / Work Shifts | Listed in the broader menu only | Unverified |
| HR & Staff | Faculty Performance | Report catalogue reference only | Partial; calculation and drilldown unverified |
| CRM & Growth | Lead CRM | Lead directory, status/filter controls, empty state and add action | Page observed; successful create/update unverified |
| CRM & Growth | Lead Nurturing | Summary cards, filters, empty state and create-sequence dialog | Page/form observed; execution and delivery unverified |
| CRM & Growth | Proposals | Proposals page with summary cards and empty state | Page observed; proposal workflow unverified |
| CRM & Growth | Meta Lead Ads | Integration setup page with status cards and setup controls | Page observed; credentials, consent and connection unverified |
| CRM & Growth | Refer & Earn, Alumni Wall | Listed in broader menu/spec only | Unverified |
| Communication | Bulk Messaging | Composer, recipient/audience selector, message fields, channel/delivery controls and recent messages | UI observed; delivery unverified |
| Communication | Inbox | Contact/conversation list, selected thread and reply field | UI observed; delivery/read state unverified |
| Communication | SMS/WhatsApp Hub, Email Campaigns, Custom Forms | Listed in the broader menu/spec only | Unverified |
| Communication | Custom Columns | Page with student and admission/enquiry column cards | Page observed; editing/storage unverified |
| Communication | PTM Meetings | Empty meeting page and a Schedule PTM Session form with teacher selection | Page/form observed; booking and notification unverified |
| Operations | Library, Library Fines, Transport, Hostel, Inventory, Canteen, Gamification | Present in the older menu, not demonstrated in the recording | Unverified |
| Settings | General Settings, Branches, Roles & Permissions, Mobile App Branding, Integrations, AI Credits | Listed in the older menu; no complete settings workflow confirmed | Unverified |

## Cross-screen observations

- Persistent left sidebar with grouped navigation and menu search, white utility/header bar, light blue-gray work area, blue active/primary controls, white cards with fine borders, status colors and a floating help/assistant control.
- List pages commonly show summary cards, search/filter controls, action buttons and a large empty state. Create/edit flows use dialogs or long forms; date pickers and selectors are visible in student, batch, live-class and exam flows.
- Long forms expose more content by scrolling; the student and staff forms include a side summary/photo area.
- The recording shows some successful-looking UI transitions (student create, course/batch display, fee collection/receipt), but cannot establish server persistence.

## Existing implementation and reuse candidates

- The active frontend is already under `client/` and uses React, TypeScript, Vite and Tailwind. The existing `client/src/pages/AdminPage.tsx` implements only a limited admin workspace (overview, students, admissions, attendance, staff, courses/batches, fees and settings).
- `old-html/admin-app.js` is the older, broad local admin prototype. It has grouped navigation and browser-only draft flows for many reference areas. Reuse its feature labels, form structure and interaction ideas when porting screens to React, but do not reuse its DOM-string renderer or local demo data as live application state.
- The video does not verify every broader menu destination. Preserve those items in this inventory as unverified rather than presenting them as completed product behavior.
