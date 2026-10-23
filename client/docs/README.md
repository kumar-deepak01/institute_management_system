# Client setup and run

Requires Node.js 18 or newer. From `client/`:

```sh
npm install
npm run dev
```

Open the Vite URL, normally `http://127.0.0.1:5173`. Create a production bundle with `npm run build`; preview it with `npm run preview`. Set the API base in `.env` using `VITE_API_URL`. The default Vite proxy sends `/api`, `/health`, and `/uploads` to the server at `http://127.0.0.1:3000`.
