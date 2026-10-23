const path = require('node:path');
const projectRoot = path.resolve(__dirname, '../..');
const requestedPort = Number(process.env.PORT || process.argv[2] || 3000);
const localOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'];
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim().replace(/\/+$/, '')).filter(Boolean);
const allowedOrigins = new Set([...localOrigins, 'https://institutemanagementsystem-lake.vercel.app', ...configuredOrigins]);
module.exports = { projectRoot, requestedPort, allowedOrigins };
