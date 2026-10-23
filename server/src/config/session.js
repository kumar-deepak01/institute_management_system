const crypto = require('node:crypto');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sessionSecret = process.env.SESSION_SECRET || (process.env.VERCEL ? '' : randomToken(48));
const admissionAdminToken = process.env.ADMISSIONS_ADMIN_TOKEN || (sessionSecret ? crypto.createHmac('sha256', sessionSecret).update('admissions-admin').digest('base64url') : randomToken());
module.exports = { sessionSecret, admissionAdminToken };
