# Routes

`apiRoutes.js` handles API method dispatch and delegates endpoint logic to `controllers/apiController.js`. `staticRoutes.js` preserves the existing safe static-file handler. Both are wired by `src/app.js`, which is loaded by the root `server.js` entry point.
