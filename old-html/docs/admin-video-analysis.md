# CoachSutra Admin video analysis

**Review date:** 2026-10-19  
**Reference:** `reference/choch_sutra.mp4` (1918×1182, approximately 31:20)  
**Review method:** local Windows Media Foundation/WPF playback with screenshots sampled every six seconds; 315 sampled frames arranged into contact sheets in [`admin-video-frames`](admin-video-frames/). Selected views are called out by timestamp below.  
**REA limitation:** REA was requested, but the available REA tools in this session did not expose a video/audio playback, frame extraction, or transcription operation. REA therefore did not watch or transcribe the recording. Local WPF decoding was used for visual review and this distinction is retained throughout.

## Coverage and evidence limits

The video file was readable locally and the complete duration was visually sampled from 00:00 to 31:18, with the final sampled frame within roughly two seconds of the end. A sampled frame may miss a short-lived dialog or click between six-second intervals. Contact sheets preserve the sampled frame and timestamp; larger frame references were not made for every interaction. Small text, field labels, exact amounts, and transient validation details are not reliably legible in the contact sheets, so they are marked unknown instead of guessed.

The recording shows a Google Meet floating overlay for portions of the early capture, and later screens appear to be a guided/sandbox account with mostly empty records and sample content. We can observe UI states, not private service code, persistence, permission enforcement, or production business rules. No external website or backend was accessed as part of this video analysis.

No audio extraction or transcription was available. Narration was not reviewed, and there is no claim that any spoken instructions were heard. The video’s audio-track presence/content is unverified.

## Timestamped walkthrough

Timestamps are recording positions, not website timestamps. Contact-sheet references are relative to this document’s directory.

| Video time | Screen / action visible | Evidence and notes |
|---|---|---|
| 00:00–00:18 | Admin Students list, initially empty | `admin-video-frames/sheet-01.png`; student summary cards read as zeroed. Table includes Student, Admission No., Batch, Subjects, Attendance, Fees and Risk. Actions include AI Risk Scores, Bulk Update, Import, Export and Admit Student. Exact filter controls are too small to read. |
| 00:24–01:18 | Course/program creation and course master | `sheet-01.png`; an add-course dialog/form is opened, then course/program master appears. The form’s exact labels, required fields, save response, and validation cannot be recovered at this sampling scale. |
| 01:24–03:06 | Batches list and Create New Batch | `sheet-02.png`; empty state followed by batch form. Batch creation is visibly attempted/opened; successful save/result was not captured clearly enough to assert. |
| 03:12–06:06 | Add New Student workflow | `sheet-03.png`–`sheet-04.png`; long multi-section form for personal information, academic details, parent/guardian details, and photo. At about 05:xx a credentials/help overlay is visible but its text is not reliably legible. |
| 06:06–06:24 | Student save and list update | `sheet-04.png`–`sheet-05.png`; a success toast and one student row appear; aggregate student count changes from zero to one. This indicates a visible create transition in the captured session, not proof of server persistence. |
| 06:24–08:54 | Student profile, fee assignment, payment collection, receipt | `sheet-05.png`–`sheet-06.png`; profile has attendance and fee-related information; Assign Fee to Student action, payment details/history, Collect Payment dialog, then browser print/receipt view. The sequence visually connects a student to fee assignment and a payment/receipt. Exact fields, values, payment gateway, and receipt delivery are not verifiable. |
| 09:36–09:48 | Admin Dashboard | `sheet-07.png`; institute overview with KPI cards, quick actions, enrollment trend chart, fee/revenue overview and other dashboard panels. Displayed demo account label appears as JEE Mentor. Exact metric values are not transcribed because the frame resolution is insufficient. |
| 09:54–11:06 | Lead Management | `sheet-07.png`–`sheet-08.png`; lead list, status/filter controls, empty state and Add Lead entry point. No successful lead create/update is clearly evidenced. |
| 11:12–12:42 | Meta Lead Ads Integration | `sheet-08.png`; integration setup/settings screen for Meta lead ads. The screen is visible, but exact credential fields, consent, test, and connected states are not legible/confirmed. |
| 13:00–14:12 | Lead Nurturing Automation | `sheet-09.png`; sequence dashboard with four zero-valued summary cards, filters and empty state/Create First Sequence. No sequence outcome shown. |
| 14:18–15:24 | Lead management/navigation, then Smart Billing Hub | `sheet-09.png`–`sheet-10.png`; lead page returns and navigation groups expand. Billing hub shows financial summary cards and a billing/collection workspace. Exact amounts, calculation rules, and any posted transactions are unknown. |
| 16:18–18:12 | Schedule Live Class form | `sheet-11.png`–`sheet-12.png`; Live Classes route with a Schedule Live Class form/dialog, session option cards, class details, date/time-like fields, and calendar picker. A warning/instruction strip is visible. Submission/result is not established. |
| 18:18–20:00 | Add New Staff | `sheet-12.png`–`sheet-14.png`; staff form includes account information, employment type cards (Full-Time, Contractual, Part-Time, Hourly), profile/photo region, compensation/employment sections, and a side summary. A later screen shows staff list/card with a record. The exact sequence and whether the record was created in this session are uncertain. |
| 20:00–23:30 | Staff directory and staff profile/record tabs | `sheet-14.png`–`sheet-15.png`; staff page with KPI cards, search/filter controls, a staff card/record, then a detailed staff profile with tabs and editable sections such as attendance/leave, payroll, and employment information. Exact tab names/fields are partly illegible. |
| 23:36–25:18 | Reports & Analytics | `sheet-15.png`–`sheet-16.png`; report catalogue with many separate report cards. Legible categories include student progress, student data, attendance, fee collection, top performers, student performance, staff/teacher performance, payroll, admission, exam, payment/transaction and income/expense-style reports. Some lower cards are cropped in the sample. Filters/export behavior and report contents are not demonstrated. |
| 25:24–25:48 | Schedule PTM Session | `sheet-16.png`–`sheet-17.png`; parent-teacher meeting scheduling form with session details and teacher selection section. Exact required fields and notification behavior are unknown. |
| 25:54–27:06 | Bulk Communication | `sheet-17.png`–`sheet-18.png`; composer plus Recent Messages panel; audience/recipient chips, channel/recipient selector, title and message body, delivery options/checkboxes, Save/Send-like controls. Dropdown is opened and long recipient/group options are visible. Delivery outcome is not captured. |
| 27:12–27:36 | Messages inbox | `sheet-18.png`; list of conversations at left, selected conversation pane and reply box/send control; empty/no-message state in the selected pane. Message delivery/receipts are not verified. |
| 27:42–27:54 | Live Classes list | `sheet-18.png`; summary cards, filter/status chips and an empty state with a schedule/create action. This is separate from the previously opened scheduling form. |
| 28:00–28:06 | Test Series | `sheet-18.png`; summary cards and empty state/Create Test Series action. |
| 28:06–28:48 | Create New Exam | `sheet-18.png`–`sheet-19.png`; choice between Online Exam and Offline/Paper Exam followed by an exam details form and exam settings. Course/subject and schedule/marks-like fields are visible; exact field list and validation are not fully legible. |
| 28:48–29:00 | Question Bank | `sheet-19.png`; empty question bank with search/filter controls and add/import actions. |
| 29:00–30:42 | Exam/question configuration and validation | `sheet-19.png`–`sheet-20.png`; exam creation form is revisited/scrolled, advanced settings are visible and a date picker opens. At about 29:54 a red validation/error banner appears after an attempted action; exact text/cause cannot be read. No successful exam creation is confirmed. |
| 30:48–31:00 | Homework & Assignments | `sheet-20.png`; summary cards, filter/search controls, empty state and Assign Homework action. No assignment submission is shown. |
| 31:06–31:12 | Attendance | `sheet-20.png`; attendance page with date/batch-like controls, summary cards/percentages, present/absent/late filters and a student/record tile. A save or bulk attendance action appears, but the exact interaction/result is not established. |
| 31:12–31:20 | Academic Years | `sheet-20.png`; empty state and Create First Year action. Creation form is not shown. |

## Observed product areas

The recording directly shows these UI areas: student directory and profile, course/program master, batches, student admission, fee assignment and collection/receipt, admin overview dashboard, leads, Meta lead integration, lead nurturing automation, billing hub, live class scheduling/list, staff creation/directory/profile, analytics/report catalogue, PTM scheduling, bulk communications, inbox messaging, test series, online/offline exam creation and settings, question bank, homework/assignments, attendance, and academic years.

The recording also visibly includes app navigation for other sections, but a navigation label alone does not establish its page or behavior. Do not treat modules such as certificates, ID cards, expenses, learning materials, certificates, or payroll as verified solely because they are mentioned in the broader product/reference materials. Payroll-related information is at least hinted at in the staff profile/report catalogue, but a complete payroll run and payslip workflow are not shown.

## Evidence-backed observations vs inference

### Directly observed

- Admin workspace has a left sidebar, top search/utility bar, active-route highlighting, central workspace and floating assistant/help control.
- Several pages have summary KPI cards, filters/search, list/table/card content, and explicit empty states.
- Student admission visibly changes the list and count in the recording.
- A student profile exposes fee information and a fee/payment/receipt sequence.
- Create forms exist for course, batch, student, staff, live class, PTM, communications and exam-related workflows.
- Report catalogue is broader than a single dashboard chart.
- A red error banner is visible during the exam-creation sequence.

### Inference (not a production contract)

- A student likely references a course and batch; a batch likely groups students and is assigned to staff/teachers, based on form labels and profile/detail context.
- Fee assignment likely creates expected charges/installments; payment collection likely reduces an outstanding balance and produces a receipt, based on the visible page sequence.
- Attendance, exam scores, homework status and financial records likely feed some report cards/KPIs. The video does not reveal formulas, aggregation boundaries, or update latency.
- Lead ad integration and bulk communication likely depend on third-party APIs. No credentials, HTTP requests or successful remote delivery were observed.
- The application appears to support institute-level data and roles, but tenant isolation and authorization cannot be confirmed from UI footage.

## Unknowns to settle before backend or parity claims

1. Audio track presence, narration wording, and spoken instructions: not reviewed.
2. Exact labels, required/optional state, input constraints, default values and validation text for dense forms.
3. Whether save/send/collect actions persist remotely, what confirmations follow, and how errors/retries are handled.
4. Dashboard KPI definitions, filters, time windows, chart series, rounding and currency conventions.
5. Fee installment/discount/late-fee/tax/refund rules; payment provider; receipt numbering and format.
6. Student promotion/transfer/drop lifecycle and duplicate prevention.
7. Staff payroll approval, salary calculation, payslip publication and bank/payment workflow.
8. Attendance roster/date/class constraints and correction/audit policy.
9. Exam question formats, grading, results release, retakes, proctoring and report-card rules.
10. Notification channels, audience rules, consent, scheduling and delivery status.
11. Permissions, roles, institute boundaries, audit history and data retention.
12. Responsive/mobile behavior, accessibility behavior, keyboard interaction and browser support.

See [`admin-feature-inventory.md`](admin-feature-inventory.md), [`admin-workflow-map.md`](admin-workflow-map.md), [`admin-ui-specification.md`](admin-ui-specification.md), and [`admin-codex-handoff.md`](admin-codex-handoff.md) for implementation-facing breakdowns.
