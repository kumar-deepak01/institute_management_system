const { allowedOrigins } = require('../config/env');
function isCorsResource(pathname) { return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/') || /\/(?:photo|photos|export|exports)(?:\/|$)/i.test(pathname); }
function applyCors(req, res, pathname) {
  if (!isCorsResource(pathname)) return false;
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admission-Admin-Token, X-CSRF-Token');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  return false;
}

module.exports = { isCorsResource, applyCors };
