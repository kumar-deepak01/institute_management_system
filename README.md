# My JEE Mentor

The repository has two applications: `client/` (React, TypeScript, Vite, Tailwind) and `server/` (Node.js API). `old-html/` preserves the original HTML, CSS, and JavaScript as a backup.

## Run both applications

Use Node.js 22 or newer. Copy `server/.env.example` to `server/.env`, then configure PostgreSQL and Supabase. In two terminals, from the project root:

```sh
cd server
npm install
npm run migrate
npm run migrate:sheets
npm run dev
```

```sh
cd client
npm install
npm run dev
```

Open the Vite URL (normally `http://127.0.0.1:5173`). The client uses `VITE_API_URL` for API calls. For local development, `/api`, `/health`, and `/uploads` are proxied to port 3000.

## Setup

After configuring `server/.env` and applying the database migration, create an administrator from the `server/` directory. The command prompts for the password without echoing it:

```sh
npm run create:admin -- --email admin@example.com --name "Institute Admin"
```

The script creates the account or resets the password for an existing account with that email. Passwords must be at least 10 characters. Sign in at `/login`; the admin account lands on `/admin`.

App-specific setup and architecture: [client/docs/README.md](client/docs/README.md), [client/docs/STRUCTURE.md](client/docs/STRUCTURE.md), [server/docs/README.md](server/docs/README.md), [server/docs/API.md](server/docs/API.md).

The existing profile-photo migration is already applied and must not be edited or recreated. `npm run migrate` applies only later pending migrations, including the additive business-data schema. `npm run migrate:sheets` imports existing spreadsheet records once after the schema is applied. Profile photo storage is described in [server/docs/DATABASE_AUDIT.md](server/docs/DATABASE_AUDIT.md). Photos use the private bucket configured by `SUPABASE_PHOTO_BUCKET` (default `profile-photos`); the service role credential belongs only in `server/.env`.
