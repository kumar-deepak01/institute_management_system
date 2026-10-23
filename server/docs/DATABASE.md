# Database and storage

PostgreSQL is the authoritative store for API data. `src/services/postgresStore.js` writes a lossless JSON record into `app_records` and projects known domain fields into typed tables (`students`, `staff`, `accounts`, `admissions`, `courses`, `batches`, `attendance`, `fees`, `payments`, and `payroll`). The JSON record preserves legacy/API fields while typed columns support filtering and reporting.

The migration `20261021000100_add_profile_photo_metadata.sql` is the already-applied baseline and must not be changed. The additive `20261021000200_postgres_business_data.sql` adds the application schema. Apply pending migrations only after reviewing them, then import the Google Sheets snapshot with `npm run migrate:sheets`. The import refuses to overwrite existing `app_records` unless explicitly invoked with `--replace`. It reads the legacy tabs once; runtime APIs no longer use Google Sheets.

Profile-photo bytes stay in the private Supabase Storage bucket configured by `SUPABASE_PHOTO_BUCKET`. Only object paths and timestamps are stored in `students` and `staff`; images are not placed in SQL. The old admissions applicant-photo flow remains a local upload referenced in the admission record and is separate from profile photos.

`docs/FIELD_MAP.md` and `.json` map form fields to endpoints, validators, and SQL columns. `npm run verify:schema` checks required public tables/columns without printing connection details. The schema verifier expects the latest business-data migration to be applied.
