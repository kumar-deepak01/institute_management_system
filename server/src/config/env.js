const path = require('node:path');
const projectRoot = path.resolve(__dirname, '../..');
const requestedPort = Number(process.env.PORT || process.argv[2] || 3000);
const defaultCorsOrigins = [
  'https://myclassroom.myjeementor.com',
  'http://localhost:5173',
  'http://localhost:3000',
];
const configuredCorsOrigins = (process.env.CORS_ORIGIN || defaultCorsOrigins.join(','))
  .split(',')
  .map(origin => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set(configuredCorsOrigins);
module.exports = { projectRoot, requestedPort, allowedOrigins };
