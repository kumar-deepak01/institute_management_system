# Staff Payroll

The Payroll page uses the existing `staff` and `payroll` tables. Migration `20261031000100_staff_payroll.sql` adds period snapshots and supporting compensation, work-record, adjustment, advance, Zoom-event, and audit tables. Apply migrations from `server/` with `npm run migrate`; this application change does not run migrations or connect to the production database.

## Pay calculation and review

- Monthly and hybrid base pay are full-period rates by default. Absence deductions are disabled unless an administrator explicitly enables the unpaid-absence policy in a dated compensation profile.
- Hourly and per-hour earnings use approved payable minutes. Per-class pay uses approved completed classes. Hybrid pay combines its monthly base with approved per-class teaching. Cancelled, rescheduled, absent, leave, and no-show records are not payable.
- Only approved earnings/deductions and approved advance recovery enter a new draft. Advance recovery is capped at the remaining balance and installment amount.
- Each period can have one run. Review the draft, approve it, finalize it, then record settlement after confirming the actual payment. Finalization locks the saved calculation; settlement is a manual accounting record and does not transfer money.
- A draft can be recalculated in place before approval. If approved attendance, a compensation profile, or an added work record changes after draft generation, the run is marked for review and cannot be approved/finalized until recalculated. Approved and settled runs cannot be recalculated.
- Money is calculated in integer paise and stored in numeric columns. Snapshots preserve the rates, attendance/work inputs, adjustments, and calculation breakdown used for each payroll run.
- The app counts Monday through Saturday, excluding institute-wide entries in the existing Holidays calendar. Batch-specific holidays are not applied to staff payroll. No other weekly-off schedule is configured in Payroll.
- Bank account details and PAN values are not returned by Payroll APIs. This page does not initiate bank transfers or calculate PF/TDS automatically. Configure statutory deductions as explicit reviewed adjustments until an institution-approved policy is implemented.

## Staff records

Payroll work and attendance entries are stored in `payroll_work_records` and require administrator review before they affect pay. There was no staff attendance table in the existing migrations; student attendance remains untouched. Approved staff leave requests and paid/unpaid leave types are read from the existing `app_records` module, and institute-wide holidays reduce the period's working-day count. Manual records and Zoom participant reports are tied to the existing staff `id`/`staff_key` and optional class-session ID. A unique staff/session index and daily manual-attendance index prevent duplicate session imports and duplicate daily attendance rows.

## Optional Zoom attendance

Zoom is optional. In the existing Integrations page, save the Zoom Server-to-Server OAuth account ID, client ID, and client secret through the existing encrypted integration-credentials flow. Zoom participant reports require the corresponding Zoom account scopes and a publicly reachable HTTPS webhook configured for `/api/webhooks/zoom`. Set `ZOOM_WEBHOOK_SECRET_TOKEN` in the server environment yourself. The server decrypts credentials using the already-configured `INTEGRATIONS_ENCRYPTION_KEY`; this change does not read or edit `.env`.

Meeting mappings identify the expected staff member. Participant time is matched using that staff member's saved email; unmatched or ambiguous identity stays pending for review. Webhook events are signature-checked, replay-window checked, and deduplicated by event ID. A report sync is still subject to Zoom's report availability and account permissions, so the Payroll page also provides a manual retry. No Zoom credentials, access tokens, participant names, or participant email lists are written to application logs.

## Run locally

From the repository root:

```powershell
cd server
npm run migrate
npm run dev
```

In another terminal:

```powershell
cd client
npm run dev
```

The migration command is included for the operator to run; it was not run while implementing this module.
