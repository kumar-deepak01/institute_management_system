const crypto = require('node:crypto');
const multer = require('multer');
const { z } = require('zod');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSupabaseClient, getPhotoBucketName } = require('../lib/supabase');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');
const { createMeeting, updateMeeting, deleteMeeting } = require('../services/integrationProviders');

const cache = new Map();
const CACHE_MS = 12000;
const LIMIT_BYTES = 50 * 1024 * 1024;
const providerNames = new Set(['jitsi', 'zoom', 'google_meet', 'teams', 'custom']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMIT_BYTES, files: 8, fields: 24 } });
const clean = (value, max = 240) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const safeHttpUrl = value => { if (!value) return true; try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const send = (res, status, value) => json(res, status, value);
const newId = () => crypto.randomUUID();
const cacheGet = key => { const entry = cache.get(key); if (entry?.expiresAt > Date.now()) return entry.value; cache.delete(key); return null; };
const invalidate = () => cache.clear();

const schemas = {
  download: z.object({ title: z.string().trim().min(1).max(180), description: z.string().max(4000).optional().default(''), contentType: z.string().trim().min(1).max(50), subjectId: z.string().max(120).optional().default(''), subjectName: z.string().max(120).optional().default(''), accessPermission: z.enum(['view_download', 'view_only', 'staff_only']).optional().default('view_download'), externalUrl: z.string().url().max(1000).refine(safeHttpUrl).optional().or(z.literal('')).default(''), status: z.enum(['draft', 'published', 'scheduled']).optional().default('published'), publishAt: z.string().datetime().optional().or(z.literal('')).default(''), expiresAt: z.string().datetime().optional().or(z.literal('')).default('') }),
  video: z.object({ title: z.string().trim().min(1).max(180), description: z.string().max(4000).optional().default(''), batchId: z.string().max(120).optional().default(''), subjectId: z.string().max(120).optional().default(''), chapter: z.string().max(180).optional().default(''), topic: z.string().max(180).optional().default(''), externalUrl: z.string().url().max(1000).refine(safeHttpUrl).optional().or(z.literal('')).default(''), unlockAt: z.string().datetime().optional().or(z.literal('')).default('') }),
  live: z.object({ title: z.string().trim().min(1).max(180), topic: z.string().max(180).optional().default(''), provider: z.enum(['jitsi', 'zoom', 'google_meet', 'teams', 'custom']), teacherKey: z.string().min(1).max(120), subjectId: z.string().max(120).optional().default(''), batchId: z.string().max(120).optional().default(''), scheduledAt: z.string().datetime(), durationMinutes: z.coerce.number().int().min(1).max(720).default(60), recurringDaily: z.coerce.boolean().default(false), meetingUrl: z.string().url().max(1000).refine(safeHttpUrl).optional().or(z.literal('')).default(''), notes: z.string().max(4000).optional().default('') }),
};

function safeLog(endpoint, step, error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]').replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  console.error(`[content-media] endpoint=${endpoint} step=${step} failed (code=${code}): ${message}`);
}

async function authenticate(req) {
  const session = getSession(req);
  if (!session) return { error: 'Sign in required.', status: 401 };
  const account = await resolveSessionAccount(req);
  if (!account) return { error: 'Sign in required.', status: 401 };
  if (account.role !== 'admin') return { error: 'Administrator access is required.', status: 403 };
  return { session, account };
}

async function parseJson(req, res, session) {
  if (!validCsrfRequest(req, session)) { send(res, 403, { error: 'CSRF validation failed.' }); return null; }
  try { return await body(req, 64 * 1024); } catch { send(res, 400, { error: 'Invalid request body.' }); return null; }
}

function queryParams(url) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
  const limit = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get('limit') || '24', 10) || 24));
  return { page, limit, q: clean(url.searchParams.get('q'), 120).toLowerCase(), type: clean(url.searchParams.get('type'), 50), subjectId: clean(url.searchParams.get('subjectId'), 120), status: clean(url.searchParams.get('status'), 30).toLowerCase() };
}

const downloadListSql = `select d.id,d.title,d.description,d.content_type,d.subject_id,d.subject_name,s.name subject_lookup_name,d.access_permission,d.external_url,
  case when d.expires_at<=now() then 'expired' when d.status='scheduled' and d.publish_at<=now() then 'published' else d.status end status,d.publish_at,d.expires_at,d.uploaded_by,d.created_at,
  coalesce(a.attachments,'[]'::jsonb) attachments,count(*) over()::int total
  from public.download_items d left join public.subjects s on s.id=d.subject_id left join lateral (select jsonb_agg(jsonb_build_object('id',da.id,'name',da.original_name,'type',da.content_type,'size',da.file_size) order by da.created_at,da.id) attachments from public.download_attachments da where da.download_id=d.id) a on true
  where ($1='' or lower(d.title) like '%'||$1||'%' or lower(coalesce(d.description,'')) like '%'||$1||'%') and ($2='' or d.content_type=$2) and ($3='' or d.subject_id=$3)
    and ($4='' or (case when d.expires_at<=now() then 'expired' when d.status='scheduled' and d.publish_at<=now() then 'published' else d.status end)=$4)
  order by d.created_at desc,d.id limit $5 offset $6`;
const videoListSql = `select v.id,v.title,v.description,v.batch_id,b.name batch_name,v.subject_id,s.name subject_name,v.chapter,v.topic,v.external_url,v.content_type,v.file_size,v.unlock_at,v.status,v.created_at,
  (select count(*)::int from public.video_watch_progress p where p.video_id=v.id) views,
  coalesce((select round(avg(case when p.completed then 100 else 0 end))::int from public.video_watch_progress p where p.video_id=v.id),0) completion,
  count(*) over()::int total
  from public.video_lectures v left join public.batches b on b.id=v.batch_id left join public.subjects s on s.id=v.subject_id
  where ($1='' or lower(v.title) like '%'||$1||'%' or lower(coalesce(v.chapter,'')) like '%'||$1||'%' or lower(coalesce(v.topic,'')) like '%'||$1||'%') and ($2='' or v.subject_id=$2) and ($3='' or v.batch_id=$3) and ($4='' or lower(coalesce(v.chapter,''))=$4)
  order by v.created_at desc,v.id limit $5 offset $6`;
const liveListSql = `select l.id,l.title,l.topic,l.provider,l.provider_meeting_id,l.host_url,l.provider_calendar_id,l.teacher_key,t.name teacher_name,l.subject_id,s.name subject_name,l.batch_id,b.name batch_name,l.scheduled_at,l.duration_minutes,l.recurring_daily,l.meeting_url,l.notes,l.status,l.created_at,count(*) over()::int total
  from public.live_classes l left join public.staff t on t.staff_key::text=l.teacher_key left join public.subjects s on s.id=l.subject_id left join public.batches b on b.id=l.batch_id
  where ($1='' or lower(l.title) like '%'||$1||'%' or lower(coalesce(l.topic,'')) like '%'||$1||'%') and ($2='' or lower(l.status)=$2) and ($3='' or l.batch_id=$3)
  order by l.scheduled_at desc,l.id limit $4 offset $5`;
const lookupsSql = `select
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from public.batches where coalesce(active,true)),'[]'::jsonb) batches,
  coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'courseId',course_id) order by name,id) from public.subjects where lower(coalesce(status,'active')) not in ('inactive','archived')),'[]'::jsonb) subjects,
  coalesce((select jsonb_agg(jsonb_build_object('id',staff_key::text,'name',name,'role',role) order by name,staff_key) from public.staff where lower(coalesce(status,'active')) not in ('inactive','archived')),'[]'::jsonb) teachers`;

function normalizeRow(row) {
  return { id: row.id, title: row.title, description: row.description, contentType: row.content_type, subjectId: row.subject_id, subjectName: row.subject_name || row.subject_lookup_name, accessPermission: row.access_permission, externalUrl: row.external_url, status: row.status, publishAt: row.publish_at, expiresAt: row.expires_at, uploadedBy: row.uploaded_by, createdAt: row.created_at, attachments: row.attachments || [] };
}
function normalizeVideo(row) {
  return { id: row.id, title: row.title, description: row.description, batchId: row.batch_id, batchName: row.batch_name, subjectId: row.subject_id, subjectName: row.subject_name, chapter: row.chapter, topic: row.topic, externalUrl: row.external_url, contentType: row.content_type, fileSize: row.file_size, unlockAt: row.unlock_at, status: row.status, views: Number(row.views || 0), completion: Number(row.completion || 0), createdAt: row.created_at };
}
function normalizeLive(row) {
  return { id: row.id, title: row.title, topic: row.topic, provider: row.provider, meetingId: row.provider_meeting_id, hostUrl: row.host_url, providerCalendarId: row.provider_calendar_id, teacherKey: row.teacher_key, teacherName: row.teacher_name, subjectId: row.subject_id, subjectName: row.subject_name, batchId: row.batch_id, batchName: row.batch_name, scheduledAt: row.scheduled_at, durationMinutes: row.duration_minutes, recurringDaily: row.recurring_daily, meetingUrl: row.meeting_url, notes: row.notes, status: row.status, createdAt: row.created_at };
}
function listQuery(kind, params) {
  const offset = (params.page - 1) * params.limit;
  if (kind === 'downloads') return { sql: downloadListSql, values: [params.q, params.type, params.subjectId, params.status, params.limit, offset] };
  if (kind === 'videos') return { sql: videoListSql, values: [params.q, params.subjectId, params.batchId || '', params.chapter, params.limit, offset] };
  return { sql: liveListSql, values: [params.q, params.status, params.batchId || '', params.limit, offset] };
}

async function uploadToStorage(path, file, expectedMime) {
  const fileType = await import('file-type');
  const detected = await fileType.fileTypeFromBuffer(file.buffer);
  const accepted = expectedMime === 'video' ? detected?.mime === 'video/mp4' : ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(detected?.mime);
  if (!accepted) throw Object.assign(new Error(expectedMime === 'video' ? 'Choose a valid MP4 video.' : 'Choose a valid PDF or image file.'), { statusCode: 415 });
  const bucket = process.env.SUPABASE_CONTENT_BUCKET || getPhotoBucketName();
  const { error } = await getSupabaseClient().storage.from(bucket).upload(path, file.buffer, { contentType: detected.mime, upsert: false, cacheControl: '600' });
  if (error) throw new Error('Content could not be saved to private storage.');
  return { bucket, mime: detected.mime };
}
function storageBucket() { return process.env.SUPABASE_CONTENT_BUCKET || getPhotoBucketName(); }
async function signedUrl(path) {
  const { data, error } = await getSupabaseClient().storage.from(storageBucket()).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error('A temporary content link could not be created.');
  return data.signedUrl;
}
function runMultipart(req, res) {
  return new Promise((resolve, reject) => upload.fields([{ name: 'attachments', maxCount: 8 }, { name: 'video', maxCount: 1 }])(req, res, error => error ? reject(error) : resolve()));
}
function fileMagic(buffer) { return import('file-type').then(m => m.fileTypeFromBuffer(buffer)); }

function encryptCredentials(value) {
  const key = Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw Object.assign(new Error('Integration credential encryption is not configured.'), { code: 'INTEGRATIONS_KEY_INVALID' });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

async function handleContentMediaRoute(req, res, url) {
  const pathname = url.pathname;
  const routeMatch = pathname.match(/^\/api\/admin\/(downloads|videos|live-classes)(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  const integrationRoute = pathname === '/api/admin/integrations/status' || /^\/api\/admin\/integrations\/(zoom|teams)$/.test(pathname);
  if (!routeMatch && !integrationRoute) return null;
  let auth;
  try { auth = await authenticate(req); } catch (error) { safeLog(pathname, 'authenticate admin', error); return send(res, 503, { error: 'Account storage is unavailable.' }); }
  if (auth.error) return send(res, auth.status, { error: auth.error });

  if (pathname === '/api/admin/integrations/status' && req.method === 'GET') {
    try {
      const cached = cacheGet('integration-status'); if (cached) return send(res, 200, cached);
      const { rows } = await queryWithLimit(() => getPool().query(`select provider,connected from public.integration_connections where provider=any($1::text[])`, [['zoom', 'google_meet', 'teams']]));
      const status = { zoom: false, google_meet: false, teams: false };
      for (const row of rows) if (row.provider in status) status[row.provider] = Boolean(row.connected);
      const value = { providers: status }; cache.set('integration-status', { value, expiresAt: Date.now() + CACHE_MS }); return send(res, 200, value);
    } catch (error) { safeLog(pathname, 'load connection status', error); return send(res, 200, { providers: { zoom: false, google_meet: false, teams: false }, schemaPending: true }); }
  }
  if (/^\/api\/admin\/integrations\/(zoom|teams)$/.test(pathname) && req.method === 'PUT') {
    const input = await parseJson(req, res, auth.session); if (!input) return;
    const provider = pathname.split('/').at(-1);
    const parsed = z.object({ credentials: z.record(z.string(), z.string().min(1).max(4000)).refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 12) }).safeParse(input);
    if (!parsed.success) return send(res, 400, { error: 'Provide valid integration credentials.' });
    try {
      const encrypted = encryptCredentials(parsed.data.credentials);
      await queryWithLimit(() => getPool().query(`insert into public.integration_connections(id,provider,credentials_encrypted,connected,updated_at) values($1,$2,$3,true,now()) on conflict(provider) do update set credentials_encrypted=excluded.credentials_encrypted,connected=true,updated_at=now()`, [newId(), provider, encrypted]));
      invalidate(); return send(res, 200, { connected: true, provider });
    } catch (error) { safeLog(pathname, 'save encrypted integration settings', error); return send(res, error.code === 'INTEGRATIONS_KEY_INVALID' ? 503 : 500, { error: 'Integration settings could not be saved.' }); }
  }

  const [, kind, encodedId = '', action = ''] = routeMatch || [];
  const recordId = encodedId ? decodeURIComponent(encodedId) : '';
  const endpoint = pathname;
  if (kind && req.method === 'GET' && recordId === 'lookups') {
    try {
      const cached = cacheGet('content-lookups'); if (cached) return send(res, 200, cached);
      const { rows } = await queryWithLimit(() => getPool().query(lookupsSql)); const value = rows[0] || { batches: [], subjects: [], teachers: [] };
      cache.set('content-lookups', { value, expiresAt: Date.now() + CACHE_MS }); return send(res, 200, value);
    } catch (error) { safeLog(endpoint, 'load content lookups', error); return send(res, 200, { batches: [], subjects: [], teachers: [], schemaPending: true }); }
  }
  if (kind && req.method === 'GET' && recordId === 'stats') {
    try {
      const key = `${kind}-stats`; const cached = cacheGet(key); if (cached) return send(res, 200, cached);
      const table = kind === 'downloads' ? 'download_items' : kind === 'videos' ? 'video_lectures' : 'live_classes';
      const statusStats = kind === 'downloads'
        ? `select count(*)::int total,count(*) filter(where (status='published' or (status='scheduled' and publish_at<=now())) and (expires_at is null or expires_at>now()))::int published,count(*) filter(where status='scheduled' and (publish_at is null or publish_at>now()))::int scheduled,count(*) filter(where expires_at<=now())::int expired from public.${table}`
        : kind === 'videos'
          ? `select count(*)::int total,count(*) filter(where status='published')::int published,(select count(*)::int from public.video_watch_progress)::int total_views,coalesce((select round(avg(case when completed then 100 else 0 end))::int from public.video_watch_progress),0)::int avg_completion from public.${table}`
          : `select count(*) filter(where status='scheduled' and scheduled_at<=now() and scheduled_at+duration_minutes*interval '1 minute'>now())::int live_now,count(*) filter(where status='scheduled' and scheduled_at>now())::int upcoming,count(*) filter(where status='completed' or scheduled_at+duration_minutes*interval '1 minute'<=now())::int completed from public.${table}`;
      const { rows } = await queryWithLimit(() => getPool().query(statusStats)); const value = rows[0] || {};
      cache.set(key, { value, expiresAt: Date.now() + CACHE_MS }); return send(res, 200, value);
    } catch (error) { safeLog(endpoint, `load ${kind} stats`, error); return send(res, 200, { schemaPending: true }); }
  }
  if (kind && req.method === 'GET' && !recordId) {
    const params = queryParams(url); params.batchId = clean(url.searchParams.get('batchId'), 120); params.chapter = clean(url.searchParams.get('chapter'), 180).toLowerCase();
    const query = listQuery(kind, params); const cacheKey = `${kind}|${JSON.stringify(params)}`; const cached = cacheGet(cacheKey); if (cached) return send(res, 200, cached);
    try {
      const { rows } = await queryWithLimit(() => getPool().query(query.sql, query.values));
      const normalizer = kind === 'downloads' ? normalizeRow : kind === 'videos' ? normalizeVideo : normalizeLive;
      const records = rows.map(normalizer); const total = Number(rows[0]?.total || 0);
      const result = { records, total, page: params.page, limit: params.limit, pages: Math.max(1, Math.ceil(total / params.limit)), schemaPending: false };
      cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_MS }); return send(res, 200, result);
    } catch (error) { safeLog(endpoint, `list ${kind}`, error); return send(res, 200, { records: [], total: 0, page: params.page, limit: params.limit, pages: 1, schemaPending: true }); }
  }
  if (!kind) return send(res, 404, { error: 'Content route not found.' });

  if (kind === 'downloads' && req.method === 'GET' && recordId && action === 'attachments') {
    try {
      const { rows } = await queryWithLimit(() => getPool().query(`select storage_path,original_name from public.download_attachments where id=$1 and download_id=$2`, [action === 'attachments' ? url.searchParams.get('attachmentId') : '', recordId]));
      if (!rows[0]) return send(res, 404, { error: 'Attachment not found.' });
      return send(res, 200, { url: await signedUrl(rows[0].storage_path), name: rows[0].original_name });
    } catch (error) { safeLog(endpoint, 'create temporary attachment link', error); return send(res, 503, { error: 'Attachment is unavailable.' }); }
  }
  if (kind === 'videos' && req.method === 'GET' && recordId && action === 'url') {
    try {
      const { rows } = await queryWithLimit(() => getPool().query(`select storage_path,external_url from public.video_lectures where id=$1`, [recordId]));
      if (!rows[0]) return send(res, 404, { error: 'Video was not found.' });
      if (rows[0].external_url) return send(res, 200, { url: rows[0].external_url });
      if (!rows[0].storage_path) return send(res, 404, { error: 'Video file is unavailable.' });
      return send(res, 200, { url: await signedUrl(rows[0].storage_path) });
    } catch (error) { safeLog(endpoint, 'create temporary video link', error); return send(res, 503, { error: 'Video is unavailable.' }); }
  }

  if (req.method === 'POST' && !recordId && (kind === 'downloads' || kind === 'videos')) {
    if (!validCsrfRequest(req, auth.session)) return send(res, 403, { error: 'CSRF validation failed.' });
    try { await runMultipart(req, res); } catch (error) { const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400; return send(res, status, { error: status === 413 ? 'Each file must be 50 MB or smaller.' : 'Upload files in the supported format.' }); }
    const isVideo = kind === 'videos'; const parsed = schemas[isVideo ? 'video' : 'download'].safeParse(req.body);
    if (!parsed.success) return send(res, 400, { error: 'Review the required content fields and try again.' });
    const fields = parsed.data; const files = isVideo ? (req.files?.video || []) : (req.files?.attachments || []);
    if (isVideo && Boolean(fields.externalUrl) === Boolean(files.length)) return send(res, 400, { error: 'Add one MP4 video or an external video URL.' });
    if (!isVideo && !files.length && !fields.externalUrl) return send(res, 400, { error: 'Add at least one attachment or an external link.' });
    const uploaded = [];
    try {
      const checkedFiles = [];
      for (const file of files) {
        const detected = await fileMagic(file.buffer);
        const ext = isVideo ? (detected?.mime === 'video/mp4' ? 'mp4' : '') : ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[detected?.mime || ''];
        if (!ext) return send(res, 415, { error: isVideo ? 'Choose a valid MP4 video.' : 'Choose a valid PDF or image file.' });
        checkedFiles.push({ file, ext, detectedMime: detected.mime });
      }
      for (const { file, ext } of checkedFiles) {
        const id = newId();
        const folder = isVideo ? 'content/videos' : 'content/downloads'; const path = `${folder}/${id}.${ext}`;
        const stored = await uploadToStorage(path, file, isVideo ? 'video' : 'document'); uploaded.push({ id, path, file, mime: stored.mime });
      }
      const client = await getPool().connect();
      try {
        await client.query('begin');
        if (isVideo) {
          const video = { id: newId(), ...fields, batch_id: fields.batchId || null, subject_id: fields.subjectId || null, external_url: fields.externalUrl || null, storage_path: uploaded[0]?.path || null, content_type: uploaded[0]?.mime || null, file_size: uploaded[0]?.file.size || null, unlock_at: fields.unlockAt || null, status: 'published', uploaded_by: auth.account.id };
          await client.query(`insert into public.video_lectures(id,title,description,batch_id,subject_id,chapter,topic,external_url,storage_path,content_type,file_size,unlock_at,status,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [video.id,video.title,video.description,video.batch_id,video.subject_id,video.chapter,video.topic,video.external_url,video.storage_path,video.content_type,video.file_size,video.unlock_at,video.status,video.uploaded_by]);
        } else {
          const item = { id: newId(), ...fields, subject_id: fields.subjectId || null, external_url: fields.externalUrl || null, publish_at: fields.publishAt || null, expires_at: fields.expiresAt || null, uploaded_by: auth.account.id };
          await client.query(`insert into public.download_items(id,title,description,content_type,subject_id,subject_name,access_permission,external_url,status,publish_at,expires_at,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [item.id,item.title,item.description,item.contentType,item.subject_id,item.subjectName,item.accessPermission,item.external_url,item.status,item.publish_at,item.expires_at,item.uploaded_by]);
          for (const file of uploaded) await client.query(`insert into public.download_attachments(id,download_id,storage_path,original_name,content_type,file_size) values($1,$2,$3,$4,$5,$6)`, [file.id,item.id,file.path,clean(file.file.originalname,255),file.mime,file.file.size]);
        }
        await client.query('commit');
      } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
      invalidate(); return send(res, 201, { ok: true });
    } catch (error) {
      if (uploaded.length) {
        try { await getSupabaseClient().storage.from(storageBucket()).remove(uploaded.map(file => file.path)); }
        catch (cleanupError) { safeLog(endpoint, 'clean up unreferenced uploaded files', cleanupError); }
      }
      safeLog(endpoint, `create ${kind}`, error); return send(res, 500, { error: 'Content could not be saved.' });
    }
  }

  if (kind === 'downloads' && req.method === 'PATCH' && recordId) {
    const input = await parseJson(req, res, auth.session); if (!input) return;
    const status = z.enum(['draft', 'published', 'scheduled', 'expired']).safeParse(input.status); if (!status.success) return send(res, 400, { error: 'Choose a valid content status.' });
    try { const { rows } = await queryWithLimit(() => getPool().query(`update public.download_items set status=$2,updated_at=now() where id=$1 returning id,status`, [recordId,status.data])); if (!rows[0]) return send(res, 404, { error: 'Content item was not found.' }); invalidate(); return send(res, 200, { record: rows[0] }); }
    catch (error) { safeLog(endpoint, 'update content status', error); return send(res, 500, { error: 'Content status could not be updated.' }); }
  }
  if (kind === 'videos' && req.method === 'DELETE' && recordId) {
    if (!validCsrfRequest(req, auth.session)) return send(res, 403, { error: 'CSRF validation failed.' });
    try {
      const { rows } = await queryWithLimit(() => getPool().query(`delete from public.video_lectures where id=$1 returning storage_path`, [recordId]));
      if (!rows[0]) return send(res, 404, { error: 'Video was not found.' });
      if (rows[0].storage_path) await getSupabaseClient().storage.from(storageBucket()).remove([rows[0].storage_path]); invalidate(); return send(res, 200, { ok: true });
    } catch (error) { safeLog(endpoint, 'delete video', error); return send(res, 500, { error: 'Video could not be deleted.' }); }
  }

  if (kind === 'live-classes' && req.method === 'POST' && !recordId) {
    const input = await parseJson(req, res, auth.session); if (!input) return;
    const parsed = schemas.live.safeParse(input); if (!parsed.success) return send(res, 400, { error: 'Review the class details and try again.' });
    const values = parsed.data;
    let meeting = null;
    try {
      const { rows: refs } = await queryWithLimit(() => getPool().query(`select exists(select 1 from public.staff where staff_key::text=$1 and lower(coalesce(status,'active')) not in ('inactive','archived')) teacher_ok,($2='' or exists(select 1 from public.batches where id=$2)) batch_ok,($3='' or exists(select 1 from public.subjects where id=$3)) subject_ok`, [values.teacherKey,values.batchId,values.subjectId]));
      if (!refs[0]?.teacher_ok || !refs[0]?.batch_ok || !refs[0]?.subject_ok) return send(res, 400, { error: 'Choose an existing teacher, batch, and subject.' });
      if (['zoom','google_meet','teams'].includes(values.provider)) meeting = await createMeeting(values.provider, values);
      else if (values.provider === 'jitsi') meeting = { meetingId: null, meetingUrl: values.meetingUrl || `https://meet.jit.si/${crypto.randomUUID()}`, hostUrl: null, calendarId: null };
      else meeting = { meetingId: null, meetingUrl: values.meetingUrl || null, hostUrl: null, calendarId: null };
      const id = newId();
      await queryWithLimit(() => getPool().query(`insert into public.live_classes(id,title,topic,provider,teacher_key,subject_id,batch_id,scheduled_at,duration_minutes,recurring_daily,meeting_url,notes,status,created_by,provider_meeting_id,host_url,provider_calendar_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'scheduled',$13,$14,$15,$16)`, [id,values.title,values.topic,values.provider,values.teacherKey,values.subjectId||null,values.batchId||null,values.scheduledAt,values.durationMinutes,values.recurringDaily,meeting.meetingUrl,values.notes,auth.account.id,meeting.meetingId,meeting.hostUrl,meeting.calendarId]));
      invalidate(); return send(res, 201, { record: { id, ...values, meetingId: meeting.meetingId, meetingUrl: meeting.meetingUrl, hostUrl: meeting.hostUrl, providerCalendarId: meeting.calendarId, status: 'scheduled' } });
    } catch (error) {
      if (meeting?.meetingId && ['zoom','google_meet','teams'].includes(values.provider)) try { await deleteMeeting(values.provider, { meetingId: meeting.meetingId, calendarId: meeting.calendarId, meetingUrl: meeting.meetingUrl }); } catch (cleanupError) { safeLog(endpoint, 'cleanup provider meeting after save failure', cleanupError); }
      if (error.code === 'INTEGRATION_NOT_CONFIGURED') return send(res, 409, { error: 'Configure this meeting provider first.', configureUrl: '/admin/integrations' });
      safeLog(endpoint, 'schedule live class', error); return send(res, 500, { error: 'Live class could not be scheduled.' });
    }
  }
  if (kind === 'live-classes' && req.method === 'PATCH' && recordId) {
    const input = await parseJson(req, res, auth.session); if (!input) return;
    try {
      const { rows: currentRows } = await queryWithLimit(() => getPool().query('select id,title,topic,provider,provider_meeting_id,host_url,provider_calendar_id,teacher_key,subject_id,batch_id,scheduled_at,duration_minutes,recurring_daily,meeting_url,notes,status from public.live_classes where id=$1 limit 1', [recordId]));
      const current = currentRows[0]; if (!current) return send(res, 404, { error: 'Class was not found.' });
      if (input.status !== undefined) {
        if (!['completed', 'scheduled', 'cancelled'].includes(input.status)) return send(res, 400, { error: 'Choose a valid class status.' });
        if (input.status === 'cancelled' && ['zoom','google_meet','teams'].includes(current.provider) && current.provider_meeting_id) await deleteMeeting(current.provider, { meetingId: current.provider_meeting_id, calendarId: current.provider_calendar_id, meetingUrl: current.meeting_url });
        const cancelled = input.status === 'cancelled';
        const { rows } = await queryWithLimit(() => getPool().query(`update public.live_classes set status=$2,meeting_url=case when $2='cancelled' then null else meeting_url end,provider_meeting_id=case when $2='cancelled' then null else provider_meeting_id end,host_url=case when $2='cancelled' then null else host_url end,updated_at=now() where id=$1 returning id,status`, [recordId,input.status]));
        if (!rows[0]) return send(res, 404, { error: 'Class was not found.' }); invalidate(); return send(res, 200, { record: rows[0] });
      }
      const values = schemas.live.parse({ title: current.title, topic: current.topic || '', provider: current.provider, teacherKey: current.teacher_key, subjectId: current.subject_id || '', batchId: current.batch_id || '', scheduledAt: new Date(current.scheduled_at).toISOString(), durationMinutes: current.duration_minutes, recurringDaily: current.recurring_daily, meetingUrl: current.meeting_url || '', notes: current.notes || '', ...input });
      const providerChanged = values.provider !== current.provider;
      const meetingDetails = { ...values };
      let meeting = { meetingId: current.provider_meeting_id, meetingUrl: current.meeting_url, hostUrl: current.host_url, calendarId: current.provider_calendar_id };
      if (['zoom','google_meet','teams'].includes(values.provider)) {
        meeting = providerChanged || !current.provider_meeting_id ? await createMeeting(values.provider, meetingDetails) : await updateMeeting(values.provider, meeting, meetingDetails);
      } else if (values.provider === 'jitsi') meeting = { meetingId: null, meetingUrl: values.meetingUrl || current.meeting_url || `https://meet.jit.si/${crypto.randomUUID()}`, hostUrl: null, calendarId: null };
      else meeting = { meetingId: null, meetingUrl: values.meetingUrl || null, hostUrl: null, calendarId: null };
      if (providerChanged && ['zoom','google_meet','teams'].includes(current.provider) && current.provider_meeting_id) await deleteMeeting(current.provider, { meetingId: current.provider_meeting_id, calendarId: current.provider_calendar_id, meetingUrl: current.meeting_url });
      const { rows } = await queryWithLimit(() => getPool().query(`update public.live_classes set title=$2,topic=$3,provider=$4,teacher_key=$5,subject_id=$6,batch_id=$7,scheduled_at=$8,duration_minutes=$9,recurring_daily=$10,meeting_url=$11,notes=$12,provider_meeting_id=$13,host_url=$14,provider_calendar_id=$15,updated_at=now() where id=$1 returning id,title,topic,provider,provider_meeting_id,host_url,provider_calendar_id,teacher_key,subject_id,batch_id,scheduled_at,duration_minutes,recurring_daily,meeting_url,notes,status`, [recordId,values.title,values.topic,values.provider,values.teacherKey,values.subjectId||null,values.batchId||null,values.scheduledAt,values.durationMinutes,values.recurringDaily,meeting.meetingUrl,values.notes,meeting.meetingId,meeting.hostUrl,meeting.calendarId]));
      if (!rows[0]) return send(res,404,{error:'Class was not found.'}); invalidate(); return send(res,200,{record:normalizeLive(rows[0])});
    } catch (error) {
      if (error.code === 'INTEGRATION_NOT_CONFIGURED') return send(res,409,{error:'Configure this meeting provider first.',configureUrl:'/admin/integrations'});
      safeLog(endpoint, input.status ? 'update live class status' : 'update live class and provider meeting', error); return send(res,500,{error:'Live class could not be updated.'});
    }
  }
  if (kind === 'live-classes' && req.method === 'DELETE' && recordId) {
    if (!validCsrfRequest(req, auth.session)) return send(res, 403, { error: 'CSRF validation failed.' });
    try { const { rows } = await queryWithLimit(() => getPool().query('select provider,provider_meeting_id,provider_calendar_id,meeting_url from public.live_classes where id=$1 limit 1',[recordId])); if (!rows[0]) return send(res,404,{error:'Class was not found.'}); if (['zoom','google_meet','teams'].includes(rows[0].provider) && rows[0].provider_meeting_id) await deleteMeeting(rows[0].provider,{meetingId:rows[0].provider_meeting_id,calendarId:rows[0].provider_calendar_id,meetingUrl:rows[0].meeting_url}); const result = await queryWithLimit(() => getPool().query(`delete from public.live_classes where id=$1`, [recordId])); if (!result.rowCount) return send(res, 404, { error: 'Class was not found.' }); invalidate(); return send(res, 200, { ok: true }); }
    catch (error) { safeLog(endpoint, 'delete live class', error); return send(res, 500, { error: 'Class could not be deleted.' }); }
  }
  return send(res, 405, { error: 'Method not allowed.' });
}

module.exports = { handleContentMediaRoute, downloadListSql, videoListSql, liveListSql, lookupsSql };
