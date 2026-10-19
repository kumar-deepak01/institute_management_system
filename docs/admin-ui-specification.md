# CoachSutra Admin UI specification from video

This is a reconstruction specification for the visible reference UI. Use it as a guide for a demo interface; do not infer production rules where the evidence is incomplete. Timestamp/frame references point to [`admin-video-analysis.md`](admin-video-analysis.md) and `admin-video-frames/sheet-*.png`.

## Shared application shell

- Persistent white left sidebar with Coach Sutra logo, menu search, grouped navigation and active item styling.
- White top bar with menu toggle, current page/breadcrumb, global search (placeholder visibly references students/leads/fees), notification, settings and sign-out controls.
- Light blue-gray work canvas; white cards/forms with rounded corners, fine blue-gray borders and soft shadows; bright blue primary actions and blue headings; green/orange/red accents for statuses.
- Floating assistant/help control at lower-right.
- Pages commonly have title/subtitle, summary cards, a search/filter row, data panel and an explicit empty state.
- The recording viewport is desktop-sized. Responsive behavior, keyboard accessibility, focus order and screen-reader names are not evidenced.

## Screen specifications

### Dashboard (09:36)

- Institute context/welcome panel and KPI cards.
- Quick actions for common admin tasks.
- Student enrollment trend chart and fee/revenue/status overview panels.
- Additional operational panels below the fold are likely; sampled view only establishes visible content.
- Do not hard-code the reference’s sample values as business truth. Show metric labels, selected period and empty/loading/error states.

### Students directory and admission (00:00; 03:12–06:24)

- Directory summary cards; searchable/filterable student grid/table.
- Visible columns include student, admission number, batch, subjects, attendance, fees and risk.
- Header actions include AI risk scores, bulk update, import, export and Admit Student.
- Admission page is divided into Personal Information, Academic Details, Parent/Guardian Details, and photo upload/preview areas; a side summary card appears.
- Save returns to/update the student directory and shows a success toast in the recording.
- **Unknown fields:** exact names, required markers, formats, allowed choices, generated values, consent, validation and failure copy. Confirm from high-resolution capture/product owner before treating field list as complete.

### Courses/programs and batches (00:24–03:06)

- Course/program master with add form/dialog.
- Batches page with empty state and Create New Batch form.
- Keep create forms distinct from list pages and connect batch options to course/teacher/student selectors only after confirming exact relationship rules.
- Exact field labels and save outcomes are not readable/confirmed.

### Student profile, fees and receipt (06:24–08:54)

- Profile shows student identity and attendance/fee-related summaries.
- Assign Fee to Student action opens a fee assignment form.
- Payment/history context offers Collect Payment; a print/receipt preview follows the captured action sequence.
- Show payment state and receipt view distinctly; do not simulate a completed payment without explicit confirmation in the demo data.
- Exact fields, amounts, methods, installments and receipt structure remain unknown.

### Leads, integration, nurturing (09:54–14:12)

- Lead list with status/filter controls and Add Lead affordance.
- Separate Meta Lead Ads Integration/settings page.
- Separate Lead Nurturing Automation overview with four summary counters, filtering and an empty state/Create First Sequence.
- Integration setup should visibly distinguish disconnected, connecting, connected, and error states if implemented; only the setup surface is observed, not those states.

### Smart Billing Hub (about 15:30)

- Financial KPI cards plus billing/collection workspace.
- Labels/amounts are not legible enough to specify exact fields or formulas. Preserve currency/date range labels and make totals traceable to rows in a real implementation.

### Live classes and PTM (16:18; 25:24–25:48; 27:42)

- Live classes list has summary cards, status/filter chips, empty state and schedule action.
- Schedule Live Class form has session-option cards, class details, date/time fields and a date picker; warning/instruction strip visible.
- PTM has a separate Schedule PTM Session screen with session details and Select Teachers area.
- Provider integration, meeting URL generation, parent/student audience and notification behavior are unknown.

### Staff (18:18–23:30)

- Add New Staff is a long form with account information, profile/photo, compensation/employment details and a right-side summary.
- Employment type choices shown: Full-Time, Contractual, Part-Time, Hourly.
- Staff directory has summary cards, search/filter and staff cards/rows; profile opens a detail view with tabs/sections, including payroll/attendance-like areas.
- Exact input labels, required state, permissions and salary calculations are unknown.

### Reports & Analytics (23:36–25:18)

- Catalogue of report cards, organized in a multi-column grid with icons and short descriptions.
- Visible categories: student progress/data, attendance, fee collection, top performers/student performance, teacher/staff performance, payroll, admissions, exams, payment/transaction, and income/expense-style reporting.
- Report parameters, drilldown, export format and generated output are not shown.

### Bulk Communication and Messages (25:54–27:36)

- Bulk communication uses a composer with recipient/audience selectors, message channel/type options, title, message body, delivery options and recent messages panel.
- Recipient selector expands to a long list of groups/options.
- Messages area has conversation list, selected thread, reply field and send control.
- Do not infer exact channels or successful delivery. Show pending/sent/failed only when backed by a real action/state.

### Exams, Question Bank, Test Series (28:00–30:42)

- Test Series overview uses summary cards and an empty state/create action.
- Create New Exam first offers Online Exam and Offline/Paper Exam mode cards, then an exam details form and advanced settings.
- A date picker is visible; a red error banner follows an attempted action. Exact error and form fields are not readable enough to transcribe.
- Question Bank has search/filter controls, empty state and add/import actions.
- Exact question schema, exam validation, timing, grading and result publishing are unknown.

### Homework, Attendance, Academic Years (30:48–31:20)

- Homework & Assignments: summary cards, search/filter row, empty state, Assign Homework action.
- Attendance: date/batch-like controls, status summary cards and status filters; a record card appears.
- Academic Years: empty state and Create First Year action.
- Creation, roster rules, attendance saving and year rollover are not demonstrated.

## Form/action state requirements for a faithful demo

For every form, implement at least the visible states implied by the footage: initial/empty, editing, dropdown/date picker open, validation/error, successful confirmation, and updated list/detail state. Where the video does not show the exact response, label it as a prototype behavior rather than presenting it as observed parity. Preserve browser print preview for receipt only if a local printable receipt is intentionally part of the demo.

## Visual acceptance criteria

1. Desktop shell has a persistent, grouped sidebar and top utility bar; active navigation is obvious.
2. Workspace uses the light blue-gray background and white rounded panels shown in the reference.
3. Dashboard contains clearly separated KPI, trend, finance and operational panels, with correct empty/error states.
4. Directory pages distinguish filters, table headers, row actions and empty results.
5. Long forms use clear section headings and keep the primary action discoverable while scrolling.
6. Form validation errors are visible, specific and tied to affected fields; success notices do not imply an external transaction unless implemented.
7. Date pickers and recipient/option selectors open and can be dismissed without losing unrelated form input.
8. Finance figures include currency and period context; receipt print layout is legible.
9. Staff employment type choices match the visible labels.
10. Communication, exam and report areas have empty/loading/error/success states and do not show fictitious delivery/processing as real service data.
11. Frame comparison should use original-resolution captures rather than the six-second contact-sheet thumbnails for exact spacing or typography decisions.

See [`admin-codex-handoff.md`](admin-codex-handoff.md) for implementation boundaries and open decisions.
