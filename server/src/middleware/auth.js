const crypto = require('node:crypto');
const { allowedOrigins } = require('../config/env');
const { sessionSecret } = require('../config/session');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function getSession(req) {
  if (!sessionSecret) return null;
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)cs_session=([A-Za-z0-9_.-]+)/);
  if (!match) return null;
  const [payload, signature] = match[1].split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.accountId || session.expiresAt < Date.now()) return null;
    return { ...session, sessionVersion: Number(session.sessionVersion || 0), token: match[1] };
  } catch { return null; }
}

function setSession(req, res, account) {
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ accountId: account.id, sessionVersion: Number(account.sessionVersion || 0), csrfToken, expiresAt: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `cs_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${secure ? '; Secure' : ''}`);
}

function validCsrfRequest(req, session) {
  const origin = req.headers.origin || '';
  const token = req.headers['x-csrf-token'] || '';
  return Boolean(origin && allowedOrigins.has(origin) && session?.csrfToken && safeEqual(token, session.csrfToken));
}

function accountView(account) { return { email: account.email, role: account.role, name: account.name, studentId: account.studentId, mustChangePassword: account.mustChangePassword }; }
module.exports = { getSession, setSession, accountView, safeEqual, validCsrfRequest };
