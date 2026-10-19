# Admin Dashboard implementation handoff

## Objective

Use the supplied CoachSutra recording as a reference for a role-specific Admin workspace in the existing static project. The current project is a front-end concept; this analysis is not evidence of a private backend/API or production data model.

## Evidence package

- Complete recording located at `reference/choch_sutra.mp4`, approximately 31:20.
- Full video visually sampled at six-second intervals: 315 frames, 20 contact sheets in `docs/admin-video-frames/`.
- Walkthrough and confidence limits: [`admin-video-analysis.md`](admin-video-analysis.md).
- Module inventory and current-project status: [`admin-feature-inventory.md`](admin-feature-inventory.md).
- Data relationship workflow map: [`admin-workflow-map.md`](admin-workflow-map.md).
- Screen/UI requirements: [`admin-ui-specification.md`](admin-ui-specification.md).
- Audio was not extracted, listened to, or transcribed. REA did not provide video/audio inspection in this session; local WPF decoding supplied frame evidence.

## Existing project boundary

Read-only source inspection covered `admin.html`, shared `portal.js`/`portal.css`, `app.js`, `README.md`, and current docs. Admin is a role entry into a shared static frontend. It already contains sample dashboard metrics/charts, navigation destinations, generic sample tables and limited local demo interactions. Selected student/homework/exam/leave data is browser-local; there is no server/database/authentication, payment, Meta, SMS/WhatsApp/email or live-video service. Many Admin routes are generic renderer views and are not equivalent to the video’s module-specific screens.

**No app source or demo records were modified during this analysis.** Only analysis documents and timestamped frame references were created.

## Recommended build order

1. Preserve the public homepage, common login, Teacher workspace and Student workspace. Scope changes to Admin assets/views and shared changes only when needed without changing existing role behavior.
2. Build Admin shell/navigation and dashboard with local fixture data and explicit demo labels.
3. Implement the core graph: academic years → courses/programs → batches → student admission/profile → fee assignment → payment history/printable receipt.
4. Implement staff directory/profile and employment type choices; leave payroll calculations and payslip issuance as placeholders until rules are supplied.
5. Add leads, integration setup mock state and nurturing overview; do not send data to Meta.
6. Add live classes/PTM forms, bulk communication/inbox, test series/exams/question bank, homework and attendance.
7. Add report catalogue with explicit parameter/output contracts only after metric definitions are agreed.
8. Add responsive/accessibility polish and compare against source-resolution frames when available.

This order is a proposal, not a claim about the order used by CoachSutra.

## Data model caution

Reasonable prototype entities inferred from visible context: Institute, Admin/User, Student, Parent/Guardian, Course/Program, Academic Year, Batch, Staff/Teacher, Admission, Fee Assignment/Installment, Payment, Receipt, Lead, Communication, Live Class, PTM Session, Homework, Exam, Question, Attendance, Report. These are design candidates only. Confirm ownership, identifiers, status lifecycles, deletion and history rules before creating a persistent schema. Avoid coupling reported totals to hard-coded cards.

## Decisions needed for exact behavioral parity

- High-resolution form screenshots or a narrated specification for student, course, batch, staff, fee, live class, PTM, communication and exam fields.
- Audio/narration or an authorized transcript (not available in this analysis environment).
- KPI definitions, sample dataset and report formulas/date ranges.
- Fee rules, payment modes, reversals/refunds, discounts, reminders and receipt numbering.
- Lead stages, conversion, Meta integration permissions and consent policy.
- Staff role/permissions, employment/payroll rules, approvals and payslip publication.
- Attendance correction, exam grading/result release, question formats and retake rules.
- Communication channels, audience/consent rules and delivery states.
- Whether the next phase is UI-only/local-demo or includes an approved backend.

## Acceptance criteria for the next implementation task

1. Admin can be opened directly from `admin.html`; no public landing, login, teacher or student route regresses.
2. Admin modules shown in the video have purpose-built screens or are explicitly deferred; none of the key screens is silently represented by unrelated generic rows.
3. Student admission visibly updates a local demo record/list; profile links to a batch and fee context where configured.
4. Fee assignment, payment collection and receipt preview are coherent demo states; the UI never reports a real charge unless an approved payment integration exists.
5. Staff form includes the four observed employment choices; payroll/payslip claims remain clearly demo-only until specified.
6. Lead, live class, PTM, communication, exam, question bank, homework, attendance, academic years and reports have visible empty, form, validation and success states appropriate to the prototype scope.
7. Dashboard cards and report catalogue use a documented fixture/source mapping and selected period; no unsupported formulas are presented as reference facts.
8. All visible controls respond locally or are disabled/marked as not connected; no button falsely claims a remote operation succeeded.
9. Desktop layout follows the observed left-nav/top-bar/card system, and narrow viewports remain usable.
10. Source-level and browser verification are reported separately; this analysis task did not run implementation tests.

## Readiness

**Ready to begin a UI-only Admin prototype from the observable screens. Not ready to claim complete behavioral parity, define production data workflows, or connect services.** The main blockers to exact parity are inaccessible audio/narration, unreadable fine form labels in sampled frames, unobserved save/send/payment outcomes, and undefined business/reporting rules. Ask for those details only when they become necessary to implement the corresponding behavior.

## Phase 1 implementation update

The UI-only Admin phase is implemented in `admin-app.js` / `admin-app.css`, loaded by `admin.html` instead of the shared `portal.js`. Teacher, Student, public and login source references remain unchanged. The implemented core is course/program → batch → student admission/profile → fee assignment → demo payment → printable demo receipt, using the isolated `cs-admin-demo-v1` browser key. Other observed Admin screens have local preview interactions or explicit deferred states as described in `admin-feature-inventory.md`.

Source syntax checks passed and static HTTP requests for Admin, homepage, login, Teacher and Student HTML returned 200. Browser interaction verification is still incomplete: controlled REA capture did not return and direct headless Chrome startup was denied by the host environment. Do not claim screenshot fidelity, mobile usability or successful interactive regression checks until those are run in a browser.
