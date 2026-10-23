# Server environment

Set these values in `server/.env`; do not commit service-account credentials.

| Variable | Purpose | Required |
| --- | --- | --- |
| `PORT` | HTTP port (default `3000`) | No |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed by CORS; local Vite origins are defaulted | No |
| `SESSION_SECRET` | HMAC key for signed login cookies | Recommended; required for persistent session signing in serverless deployment |
| `ADMISSIONS_ADMIN_TOKEN` | Administrator token for protected endpoints | Recommended; derived from session secret if omitted |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Legacy spreadsheet ID used by one-time import | Required only for `npm run migrate:sheets` |
| `GOOGLE_CLIENT_EMAIL` | Legacy import service-account email | Required only for `npm run migrate:sheets` |
| `GOOGLE_PRIVATE_KEY` | Legacy import service-account key; newlines may be represented as `\\n` | Required only for `npm run migrate:sheets` |
| `GAS_MAIL_WEBAPP_URL` | Apps Script endpoint for OTP email delivery | Optional |
| `SUPABASE_URL` | Supabase project URL for profile-photo metadata and Storage | Required for profile photos |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role key for Supabase Storage | Required for profile photos; never expose to the client |
| `SUPABASE_PHOTO_BUCKET` | Private Supabase Storage bucket used for profile photos | Optional; defaults to `profile-photos` |
| `DATABASE_URL` | PostgreSQL connection string for runtime data and schema tools | Required for data-backed APIs, migrations, and schema verification |

Set `DATABASE_URL` from Supabase's PostgreSQL connection settings. It is required for application data, schema verification, and migrations. Apply the pending business-data migration, then run `npm run migrate:sheets` once to import the legacy records. The project must have the private bucket named by `SUPABASE_PHOTO_BUCKET` (default `profile-photos`). Startup checks the bucket and reports a sanitized warning if it is unavailable; photo endpoints then return a clear configuration/storage error. Google Sheets credentials are used only for the one-time import.

The HTTP process can start without database credentials, but data-backed API calls return a configuration error. To import legacy data, set the Sheets values, share the spreadsheet with the service account email, and enable the Sheets API for that Google Cloud project. Keep Supabase credentials in `server/.env`; never put them in `client/.env` or send them in responses/logs.
