# Server setup and run

Requires Node.js 22 or newer. From `server/`:

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env` and set the needed credentials. The existing profile-photo migration is already applied; do not edit or recreate it. After reviewing the pending SQL migration, apply it with `npm run migrate`, then import existing records once with `npm run migrate:sheets`. `npm start` runs the same `server.js` entry point. The service listens on port 3000 by default. `GET /health` reports process health. See [ENV.md](ENV.md), [API.md](API.md), and [DATABASE.md](DATABASE.md).
