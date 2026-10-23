const multer = require('multer');
const sharp = require('sharp');
const { z } = require('zod');
const { json } = require('../middleware/http');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('../controllers/apiController');
const { findProfile, saveProfile } = require('../services/profileRecords');
const { uploadPhoto, getPhotoUrl, deletePhoto, MAX_WEBP_BYTES } = require('../services/photoStorage');

const paramsSchema = z.object({ type: z.enum(['students', 'staff']), id: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/) });
const receivePhoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024, files: 1, fields: 2 }, fileFilter: (_req, file, callback) => {
  callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
} }).single('photo');
const requests = new Map();
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function rateAllowed(accountId) {
  const now = Date.now();
  const recent = (requests.get(accountId) || []).filter(stamp => stamp > now - 15 * 60 * 1000);
  if (recent.length >= 12) { requests.set(accountId, recent); return false; }
  recent.push(now);
  requests.set(accountId, recent);
  return true;
}

function staffPhotoId(profile) { return String(profile.employee_id || profile.employeeId || profile.id); }
function profilePhotoId(type, profile) { return type === 'staff' ? staffPhotoId(profile) : String(profile.student_id || profile.studentId || profile.id); }

function canManage(account, type, id) {
  if (account.role === 'admin') return true;
  return type === 'staff' && account.role === 'teacher' && [account.staffId, account.employeeId].some(value => value && String(value) === id);
}

function canView(account, type, id) {
  if (account.role === 'admin' || canManage(account, type, id)) return true;
  if (type === 'students' && ['student', 'parent'].includes(account.role)) return String(account.studentId || '') === id;
  return false;
}

function runMulter(req, res) {
  return new Promise((resolve, reject) => receivePhoto(req, res, error => error ? reject(error) : resolve()));
}

async function webpUnderLimit(input) {
  const fileType = await import('file-type');
  const detected = await fileType.fileTypeFromBuffer(input);
  if (!detected || !ALLOWED_IMAGE_MIMES.has(detected.mime)) throw Object.assign(new Error('Choose a real JPEG, PNG, or WebP image.'), { statusCode: 415 });
  for (const quality of [82, 76, 70, 64, 58, 52, 46, 40, 34, 28]) {
    const output = await sharp(input, { failOn: 'error', limitInputPixels: 20_000_000 })
      .rotate().resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 6 }).toBuffer();
    if (output.length <= MAX_WEBP_BYTES) return output;
  }
  throw Object.assign(new Error('This image cannot be compressed below 50 KB. Choose a simpler or smaller image.'), { statusCode: 413 });
}

async function handlePhotosRoute(req, res, url) {
  const match = url.pathname.match(/^\/api\/photos\/([^/]+)\/([^/]+)$/);
  if (!match) return false;
  let params;
  try { params = { type: decodeURIComponent(match[1]), id: decodeURIComponent(match[2]) }; }
  catch { json(res, 400, { error: 'Invalid profile photo type or id.' }); return true; }
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) { json(res, 400, { error: 'Invalid profile photo type or id.' }); return true; }
  const { type, id } = parsed.data;
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) { json(res, 405, { error: 'Method not allowed.' }); return true; }

  const session = getSession(req);
  if (!session) { json(res, 401, { error: 'Sign in required.' }); return true; }
  let account;
  try { account = await resolveSessionAccount(req); }
  catch { json(res, 503, { error: 'Account storage is unavailable.' }); return true; }
  if (!account) { json(res, 401, { error: 'Sign in required.' }); return true; }

  if (req.method === 'GET') {
    if (!canView(account, type, id)) { json(res, 403, { error: 'You cannot view this profile photo.' }); return true; }
    try {
      const profile = await findProfile(type, id);
      if (!profile) { json(res, 404, { error: 'Profile not found.' }); return true; }
      json(res, 200, { photo_url: await getPhotoUrl(profile.photo_path, profile.photo_updated_at) });
    } catch { json(res, 503, { error: 'Profile photo is unavailable.' }); }
    return true;
  }

  if (!validCsrfRequest(req, session)) { json(res, 403, { error: 'CSRF validation failed.' }); return true; }
  if (!canManage(account, type, id)) { json(res, 403, { error: 'Administrator or matching teacher access is required.' }); return true; }
  if (!rateAllowed(String(account.id))) { json(res, 429, { error: 'Too many photo changes. Try again later.' }); return true; }

  try {
    const profile = await findProfile(type, id);
    if (!profile) { json(res, 404, { error: 'Profile not found.' }); return true; }
    const storageId = profilePhotoId(type, profile);
    if (storageId !== id) { json(res, 400, { error: 'The profile id does not match the record.' }); return true; }
    if (req.method === 'DELETE') {
      if (profile.photo_path) await deletePhoto(type, storageId);
      await saveProfile(type, profile, { photo_path: null, photo_updated_at: null });
      json(res, 200, { ok: true, photo_path: null, photo_updated_at: null });
      return true;
    }

    try { await runMulter(req, res); }
    catch (error) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      json(res, status, { error: status === 413 ? 'Incoming photo must be 200 KB or smaller.' : 'Upload one JPEG, PNG, or WebP photo in the photo field.' });
      return true;
    }
    if (!req.file || !ALLOWED_IMAGE_MIMES.has(req.file.mimetype)) { json(res, 415, { error: 'Choose a JPEG, PNG, or WebP image.' }); return true; }
    const processed = await webpUnderLimit(req.file.buffer);
    const path = await uploadPhoto(type, storageId, processed);
    const photoUpdatedAt = new Date().toISOString();
    await saveProfile(type, profile, { photo_path: path, photo_updated_at: photoUpdatedAt });
    json(res, 200, { ok: true, photo_path: path, photo_updated_at: photoUpdatedAt, photo_url: await getPhotoUrl(path, photoUpdatedAt), size: processed.length });
  } catch (error) {
    const status = Number(error.statusCode) || (error.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500);
    json(res, status, { error: status === 500 ? 'Profile photo could not be processed or saved.' : error.message });
  }
  return true;
}

module.exports = { handlePhotosRoute, webpUnderLimit };
