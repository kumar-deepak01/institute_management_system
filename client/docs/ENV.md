# Client environment

| Variable | Purpose | Local default |
| --- | --- | --- |
| `VITE_API_URL` | Optional API base URL used by the services in `src/services/`. Leave blank for local development so relative API requests use the Vite proxy. | Same origin (Vite proxy) |

Place local values in `client/.env`. Vite exposes only variables prefixed with `VITE_` to client code; do not put secrets here. The Vite development proxy forwards `/api`, `/health`, and `/uploads` to `http://127.0.0.1:3000`. Leave `VITE_API_URL` blank locally so the browser stays on the page's host and the proxy carries the session cookie.
