# Middleware

- `cors.js` handles allowed origins and preflight requests.
- `auth.js` signs/validates sessions and compares authentication tokens safely.
- `http.js` parses bounded JSON request bodies and sends JSON responses.
- `errorHandler.js` logs unexpected route errors and returns the established JSON error response.
