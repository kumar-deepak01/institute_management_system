const http = require('node:http');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { requestedPort } = require('./config/env');
const { json } = require('./middleware/http');
const { applyCors } = require('./middleware/cors');
const { handleApiRoute } = require('./routes/apiRoutes');
const { handleStaticRoute } = require('./routes/staticRoutes');
const { verifyPhotoBucket } = require('./services/photoStorage');
const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const apiRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please try again later.' } });

app.disable('x-powered-by');
app.use(helmet({
  hsts: isProduction ? undefined : false,
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: isProduction ? [] : null } },
}));
app.use((req, res, next) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (applyCors(req, res, pathname)) return;
  if (pathname.startsWith('/api/')) return apiRateLimit(req, res, next);
  return next();
});
app.use((req, res) => {
  Promise.resolve(handleRequest(req, res)).catch(() => {
    if (!res.headersSent) json(res, 500, { error: 'The server could not complete this request.' });
  });
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (applyCors(req, res, url.pathname)) return;
  if (url.pathname === '/health') return req.method === 'GET' ? json(res, 200, { ok: true }) : json(res, 405, { error: 'Method not allowed.' });
  if (url.pathname.startsWith('/api/')) return handleApiRoute(req, res, url);
  return handleStaticRoute(req, res, url);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function close(server) {
  return new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}

async function start() {
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  try {
    await verifyPhotoBucket();
    console.log('Supabase profile photo bucket is ready.');
  } catch (error) {
    console.warn(`Supabase profile photo bucket is not ready: ${error.message}`);
  }
  const bindHost = process.env.PORT ? '0.0.0.0' : '127.0.0.1';
  const ipv4 = http.createServer(app), ipv6 = http.createServer(app);
  try {
    await listen(ipv4, requestedPort, bindHost);
    if (!process.env.PORT) await listen(ipv6, requestedPort, '::1');
  } catch (error) {
    await Promise.all([close(ipv4), close(ipv6)]);
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${requestedPort} is already in use, close the old server.`);
    throw error;
  }
  ipv4.on('error', error => console.error(`IPv4 listener error: ${error.message}`));
  if (!isProduction) ipv6.on('error', error => console.error(`IPv6 listener error: ${error.message}`));
  const baseUrl = String(process.env.RENDER_EXTERNAL_URL || `http://${bindHost}:${requestedPort}`).replace(/\/+$/, '');
  console.log(`Listening on: http://${bindHost}:${requestedPort}`);
  console.log(`Health URL: ${baseUrl}/health`);
  console.log(`API base: ${baseUrl}/api`);
}

module.exports = { app, handleRequest, start };
