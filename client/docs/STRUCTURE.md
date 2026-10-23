# Client structure

- `src/main.tsx`: React root and router setup.
- `src/App.tsx`: route definitions, including the original `.html` URL aliases.
- `src/pages/`: home, feature, admission, login, admin, teacher, and student page components.
- `src/components/`: shared headers, footers, page sections, dialogs, cards, and workspace layout.
- `src/hooks/`: reusable React hooks, including persisted state.
- `src/services/`: typed API calls; `api.ts` reads `VITE_API_URL`.
- `src/services/photos.ts`: cookie-authenticated photo upload/removal with a CSRF token.
- `src/components/Avatar.tsx`, `PhotoUpload.tsx`: shared profile-photo display and selection/compression UI.
- `src/types/`: API request and response types.
- `src/utils/`: shared presentation and data helpers.
- `src/assets/`: bundled image assets.
- `src/index.css`: Tailwind directives and global font/reset rules.
- `public/`: static assets served as-is.

Vite and Tailwind configuration live at the client root. Page navigation uses React Router. Forms and workspace controls use React state; reusable data access is kept in services.
