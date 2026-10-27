'use strict';

const crypto = require('node:crypto');
const { z } = require('zod');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest, isAdminRole } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');
const { encryptIntegrationValue, decryptIntegrationValue } = require('../services/integrationVault');
const { testIntegration, getCredentials, getProctoringConfig, createProctoringSessionToken, openAiCompletion, safeCustomRequest } = require('../services/integrationProviders');

const send = (res, status, value) => json(res, status, value);
const id = () => crypto.randomUUID();
const clean = (value, max = 240) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const providers = ['zoom','google_meet','teams','whatsapp','email','sms','maya_ai','ai_exam_generation','ai_assessment','video_proctoring','api_access','priority_support','custom'];
const secretsByProvider = {
  zoom: ['clientSecret'], google_meet: ['clientSecret','refreshToken','serviceAccountJson'], teams: ['clientSecret'],
  whatsapp: ['accessToken','verifyToken'], email: ['password'], sms: ['authToken'],
  maya_ai: ['apiKey'], ai_exam_generation: ['apiKey'], ai_assessment: ['apiKey'],
  video_proctoring: ['apiKey'], custom: ['secret'], api_access: [], priority_support: [],
};
const requiredByProvider = {
  zoom: ['accountId','clientId','clientSecret','accountEmail'], teams: ['tenantId','clientId','clientSecret','organizer'],
  whatsapp: ['phoneNumberId','accessToken','verifyToken'], email: ['host','port','username','password','fromEmail'],
  sms: ['accountSid','authToken','fromNumber'], maya_ai: ['apiKey','model'], ai_exam_generation: ['apiKey','model'], ai_assessment: ['apiKey','model'],
  video_proctoring: ['provider','apiKey'], custom: ['baseUrl'],
};
const memoryRate = new Map();
const CACHE_MS = 12000;
let statusCache = null;

function logError(endpoint, step, error) {
  const code = String(error?.code || error?.status || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key|credentials|prompt)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 260);
  console.error(`[integrations] endpoint=${endpoint} step=${step} code=${code} message=${message}`);
}
function safeWebhookError(error) {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key|credentials)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 240);
  console.error(`[integrations] endpoint=/api/integrations/whatsapp/webhook step=process webhook code=${code} message=${message}`);
}
async function handleWhatsAppWebhook(req, res, url) {
  if (url.pathname !== '/api/integrations/whatsapp/webhook') return null;
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') || '';
    try {
      const credentials = await getCredentials('whatsapp');
      if (mode === 'subscribe' && token && safeEqualText(token, credentials.verifyToken) && /^\d{1,80}$/.test(challenge)) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(challenge); return true;
      }
      return send(res, 403, { error: 'Webhook verification failed.' });
    } catch (error) { safeWebhookError(error); return send(res, 403, { error: 'Webhook verification failed.' }); }
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) return send(res, 503, { error: 'Webhook signing is not configured.' });
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) return send(res, 413, { error: 'Webhook payload is too large.' }); chunks.push(chunk); }
    const raw = Buffer.concat(chunks);
    const supplied = String(req.headers['x-hub-signature-256'] || '');
    if (!verifyWhatsAppSignature(raw, supplied, appSecret)) return send(res, 401, { error: 'Webhook signature is invalid.' });
    const payload = JSON.parse(raw.toString('utf8'));
    const credentials = await getCredentials('whatsapp');
    const messageIds = [...new Set((payload.entry || []).flatMap(entry => entry.changes || []).flatMap(change => change.value?.messages || []).map(message => String(message.id || '')).filter(value => /^[A-Za-z0-9_-]{1,200}$/.test(value)))].slice(0, 100);
    const replyText = clean(credentials.replyText || process.env.WHATSAPP_REPLY_TEXT || 'Thanks for contacting us. We have received your message.', 500);
    const sendAck = async (recipient) => {
      const response = await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(credentials.phoneNumberId)}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${credentials.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { body: replyText } }), signal: AbortSignal.timeout(8000), redirect: 'error',
      });
      if (!response.ok) throw Object.assign(new Error(`WhatsApp provider returned HTTP ${response.status}.`), { status: response.status });
    };
    for (const messageId of messageIds) {
      if (!await recordWhatsAppMessage(messageId)) continue;
      const source = (payload.entry || []).flatMap(entry => entry.changes || []).flatMap(change => change.value?.messages || []).find(message => message.id === messageId);
      if (source?.from && /^\+?\d{6,20}$/.test(String(source.from))) await sendAck(String(source.from));
    }
    return send(res, 200, { ok: true });
  } catch (error) { safeWebhookError(error); return send(res, 200, { ok: true }); }
}
function safeEqualText(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && crypto.timingSafeEqual(left, right); }
function verifyWhatsAppSignature(raw, supplied, secret) {
  if (!secret || typeof supplied !== 'string') return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return safeEqualText(supplied, expected);
}
async function recordWhatsAppMessage(messageId, insert = value => queryWithLimit(() => getPool().query('insert into public.whatsapp_webhook_messages(message_id) values($1) on conflict(message_id) do nothing returning message_id', [value]))) {
  const result = await insert(messageId);
  return Boolean(result?.rowCount);
}
function limited(req, key, limit = 10, windowMs = 60000) {
  const client = req.socket?.remoteAddress || 'unknown';
  const cacheKey = `${client}:${key}`;
  const now = Date.now(), current = memoryRate.get(cacheKey);
  if (!current || current.resetAt <= now) { memoryRate.set(cacheKey, { count: 1, resetAt: now + windowMs }); return false; }
  if (current.count >= limit) return true;
  current.count += 1; return false;
}
async function authenticate(req) {
  const session = getSession(req);
  if (!session) return { error: { status: 401, message: 'Sign in required.' } };
  const account = await resolveSessionAccount(req);
  if (!account) return { error: { status: 401, message: 'Sign in required.' } };
  if (!isAdminRole(account.role)) return { error: { status: 403, message: 'Administrator access is required.' } };
  return { session, account };
}
async function parseInput(req, res, session, maxBytes = 128 * 1024) {
  if (!validCsrfRequest(req, session)) { send(res, 403, { error: 'CSRF validation failed.' }); return null; }
  try { return await body(req, maxBytes); }
  catch { send(res, 400, { error: 'Invalid request body.' }); return null; }
}
async function audit(provider, eventType, status, actorId, httpStatus = null) {
  try { await queryWithLimit(() => getPool().query('insert into public.integration_events(id,provider,event_type,status,http_status,actor_id) values($1,$2,$3,$4,$5,$6)', [id(),provider,eventType,status,httpStatus,actorId || null])); }
  catch (error) { logError('/api/admin/integrations', `write ${eventType} audit`, error); }
  statusCache = null;
}
async function findConnection(provider) {
  const { rows } = await queryWithLimit(() => getPool().query('select credentials_encrypted,connected,updated_at from public.integration_connections where provider=$1 limit 1', [provider]));
  if (!rows[0]) return null;
  let credentials = {};
  try { credentials = decryptIntegrationValue(rows[0].credentials_encrypted); }
  catch (error) { logError('/api/admin/integrations', `decrypt ${provider} configuration`, error); }
  return { row: rows[0], credentials };
}
function safeConfig(provider, credentials) {
  const secretKeys = new Set(secretsByProvider[provider] || []);
  const redactNested = value => {
    if (Array.isArray(value)) return value.map(redactNested);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(token|secret|password|api.?key|credential)/i.test(key)).map(([key, item]) => [key, redactNested(item)]));
  };
  const result = {};
  for (const [key, value] of Object.entries(credentials || {})) {
    if (secretKeys.has(key) || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password') || key.toLowerCase().includes('key')) continue;
    if (['actions','triggers','settings'].includes(key)) result[key] = redactNested(value);
    else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value;
  }
  return result;
}
function credentialsPresent(provider, credentials) {
  const required = requiredByProvider[provider] || [];
  if (provider === 'google_meet') {
    if (credentials.authType === 'service_account') return Boolean(credentials.serviceAccountJson && credentials.calendarId && credentials.accountEmail);
    return Boolean(credentials.clientId && credentials.clientSecret && credentials.refreshToken && credentials.calendarId && credentials.accountEmail);
  }
  return required.every(key => String(credentials?.[key] ?? '').trim() !== '');
}
async function saveWithConnectionCheck(provider, credentials, enabled, tester, persist) {
  if (enabled && !['api_access','priority_support'].includes(provider)) {
    if (!credentialsPresent(provider, credentials)) throw Object.assign(new Error('Complete the required fields before enabling this integration.'), { code: 'INTEGRATION_CREDENTIALS_MISSING' });
    try { await tester(provider, credentials); }
    catch (error) {
      const failure = error instanceof Error ? error : new Error('Provider connection test failed.');
      failure.integrationTestFailure = true; throw failure;
    }
  }
  return persist();
}
async function loadStatuses() {
  const { rows } = await queryWithLimit(() => getPool().query('select provider,credentials_encrypted,connected,updated_at from public.integration_connections where provider=any($1::text[])', [providers]));
  const byProvider = new Map(rows.map(row => [row.provider, row]));
  const statuses = {};
  for (const provider of providers) {
    const row = byProvider.get(provider);
    let credentials = {};
    if (row?.credentials_encrypted) {
      try { credentials = decryptIntegrationValue(row.credentials_encrypted); }
      catch (error) { logError('/api/admin/integrations', `decrypt ${provider} status`, error); }
    }
    const configured = provider === 'api_access' ? Boolean(row?.connected) : provider === 'priority_support'
      ? Boolean(process.env.PRIORITY_SUPPORT_EMAIL || process.env.PRIORITY_SUPPORT_PHONE)
      : credentialsPresent(provider, credentials);
    statuses[provider] = { enabled: Boolean(row?.connected), connected: Boolean(row?.connected && configured), configured,
      hasCredentials: Boolean(row?.credentials_encrypted), updatedAt: row?.updated_at || null,
      config: safeConfig(provider, credentials) };
  }
  const [{ rows: eventRows }, { rows: tokenRows }] = await Promise.all([
    queryWithLimit(() => getPool().query('select provider,event_type,status,http_status,created_at from public.integration_events order by created_at desc limit 30')),
    queryWithLimit(() => getPool().query('select id,token_name,created_at,last_used_at from public.integration_api_tokens where revoked_at is null order by created_at desc')),
  ]);
  return { integrations: statuses, events: eventRows, apiTokens: tokenRows,
    prioritySupport: { enabled: process.env.PRIORITY_SUPPORT_ENABLED === 'true', email: clean(process.env.PRIORITY_SUPPORT_EMAIL, 200), phone: clean(process.env.PRIORITY_SUPPORT_PHONE, 50) } };
}
async function persistConnection(provider, credentials, enabled, actorId) {
  const encrypted = encryptIntegrationValue(credentials);
  await queryWithLimit(() => getPool().query(`insert into public.integration_connections(id,provider,credentials_encrypted,connected,updated_at)
    values($1,$2,$3,$4,now()) on conflict(provider) do update set credentials_encrypted=excluded.credentials_encrypted,connected=excluded.connected,updated_at=now()`, [id(),provider,encrypted,enabled]));
  await audit(provider, 'configuration.saved', 'success', actorId);
}
function cleanCredentials(provider, raw, existing = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 32) throw new Error('Provide valid integration settings.');
  const allowed = {
    zoom: ['accountId','clientId','clientSecret','accountEmail'],
    google_meet: ['authType','clientId','clientSecret','refreshToken','serviceAccountJson','calendarId','accountEmail'],
    teams: ['tenantId','clientId','clientSecret','organizer'],
    whatsapp: ['phoneNumberId','businessAccountId','accessToken','verifyToken','replyText'],
    email: ['host','port','secure','username','password','fromEmail'],
    sms: ['provider','accountSid','authToken','fromNumber'],
    maya_ai: ['provider','apiKey','model'], ai_exam_generation: ['provider','apiKey','model'], ai_assessment: ['provider','apiKey','model'],
    video_proctoring: ['provider','apiKey','apiBaseUrl','settingsJson'],
    custom: ['name','baseUrl','secret','actionsJson','triggersJson'],
    api_access: [], priority_support: [],
  }[provider] || [];
  const merged = { ...existing };
  for (const key of allowed) {
    if (!(key in raw)) continue;
    const secret = (secretsByProvider[provider] || []).includes(key);
    if (secret && String(raw[key] ?? '') === '') continue;
    const max = key === 'serviceAccountJson' || key === 'settingsJson' || key === 'actionsJson' || key === 'triggersJson' ? 16000 : 4000;
    if (typeof raw[key] !== 'string' && typeof raw[key] !== 'number' && typeof raw[key] !== 'boolean') throw new Error('Provide valid integration settings.');
    merged[key] = typeof raw[key] === 'string' ? clean(raw[key], max) : raw[key];
  }
  if (provider === 'google_meet') merged.authType = raw.authType === 'service_account' ? 'service_account' : 'oauth';
  if (['maya_ai','ai_exam_generation','ai_assessment'].includes(provider)) merged.provider = 'openai';
  if (provider === 'email') { merged.port = Number(merged.port); merged.secure = merged.secure === true || merged.secure === 'true'; }
  if (provider === 'video_proctoring') {
    if (merged.settingsJson) { try { merged.settings = JSON.parse(merged.settingsJson); } catch { throw new Error('Proctoring settings must be valid JSON.'); } }
    if (merged.apiBaseUrl) merged.apiBaseUrl = new URL(merged.apiBaseUrl).toString();
  }
  if (provider === 'custom') {
    if (merged.actionsJson) { try { merged.actions = JSON.parse(merged.actionsJson); } catch { throw new Error('Custom actions must be valid JSON.'); } }
    if (merged.triggersJson) { try { merged.triggers = JSON.parse(merged.triggersJson); } catch { throw new Error('Custom event triggers must be valid JSON.'); } }
    if (merged.baseUrl) merged.baseUrl = new URL(merged.baseUrl).toString();
  }
  return merged;
}
function validateProvider(provider, credentials, enabled) {
  if (provider === 'priority_support' || provider === 'api_access') return null;
  if (provider === 'google_meet' && credentials.authType === 'service_account') {
    let value; try { value = JSON.parse(credentials.serviceAccountJson || ''); } catch { throw new Error('Paste valid service account JSON.'); }
    if (!value.client_email || !value.private_key) throw new Error('Service account JSON is missing required fields.');
    if (!credentials.calendarId || !credentials.accountEmail) throw new Error('Enter the Calendar ID and account email.');
  } else if (provider === 'google_meet') {
    for (const key of ['clientId','clientSecret','refreshToken','calendarId','accountEmail']) if (!String(credentials[key] || '').trim()) throw new Error(`Complete the ${key} field before ${enabled ? 'enabling' : 'saving'} this integration.`);
  }
  if (provider === 'custom') {
    const actions = credentials.actions || [], triggers = credentials.triggers || [];
    if (!Array.isArray(actions) || actions.length > 30 || actions.some(item => !item || typeof item.name !== 'string' || typeof item.path !== 'string' || !item.path.startsWith('/') || item.path.startsWith('//') || !['GET','POST','PUT','PATCH','DELETE'].includes(String(item.method || 'GET').toUpperCase()))) throw new Error('Actions must be a JSON array of named HTTP methods and relative paths.');
    if (!Array.isArray(triggers) || triggers.length > 50 || triggers.some(item => typeof item !== 'string')) throw new Error('Event triggers must be a JSON array of event names.');
    credentials.actions = actions.map(item => ({ id: clean(item.id || item.name,80), name: clean(item.name,80), method: String(item.method || 'GET').toUpperCase(), path: clean(item.path,500) }));
  }
  if (provider !== 'google_meet') for (const key of requiredByProvider[provider] || []) if (!String(credentials[key] ?? '').trim()) throw new Error(`Complete the ${key} field before ${enabled ? 'enabling' : 'saving'} this integration.`);
  if (provider === 'email' && (!Number.isInteger(credentials.port) || credentials.port < 1 || credentials.port > 65535)) throw new Error('Enter a valid SMTP port.');
  if (provider === 'google_meet' && credentials.authType !== 'service_account' && (!credentials.refreshToken || !credentials.clientId || !credentials.clientSecret || !credentials.calendarId)) throw new Error('Complete the OAuth client, refresh token and calendar fields.');
  if (provider === 'google_meet' && !credentials.accountEmail) throw new Error('Enter the Google Calendar account email.');
  if (provider === 'custom') {
    if (credentials.secret && credentials.secret.length > 4000) throw new Error('Custom connector secret is too long.');
  }
  return null;
}
function parseProvider(pathname) {
  const match = pathname.match(/^\/api\/admin\/integrations\/([a-z_]+)(?:\/(test|tokens|actions|session))?(?:\/([^/]+))?$/);
  if (!match || !providers.includes(match[1])) return null;
  return { provider: match[1], action: match[2] || '', id: match[3] || '' };
}
async function createApiToken(req, res, auth) {
  if (limited(req, 'api-token-create', 5)) return send(res, 429, { error: 'Too many token requests. Try again shortly.' });
  const input = await parseInput(req, res, auth.session, 4096); if (!input) return;
  const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(input);
  if (!parsed.success) return send(res, 400, { error: 'Enter a token name.' });
  try {
    const token = `cs_live_${crypto.randomBytes(32).toString('base64url')}`;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenId = id();
    await queryWithLimit(() => getPool().query('insert into public.integration_api_tokens(id,token_hash,token_name,created_by) values($1,$2,$3,$4)', [tokenId,tokenHash,clean(parsed.data.name,80),auth.account.id]));
    await audit('api_access','token.created','success',auth.account.id);
    return send(res, 201, { id: tokenId, name: clean(parsed.data.name,80), token });
  } catch (error) { logError('/api/admin/integrations/api_access/tokens','create API token',error); return send(res, 500, { error: 'API token could not be created.' }); }
}
async function handleAi(req, res, action, auth) {
  if (req.method !== 'POST' || !['maya_chat','exam_generation','assessment'].includes(action)) return null;
  if (limited(req, `ai-${action}`, 5)) return send(res, 429, { error: 'AI request limit reached. Try again in a minute.' });
  const input = await parseInput(req, res, auth.session, 32 * 1024); if (!input) return;
  const provider = action === 'maya_chat' ? 'maya_ai' : action === 'exam_generation' ? 'ai_exam_generation' : 'ai_assessment';
  const endpoint = `/api/admin/integrations/ai/${action}`;
  try {
    let messages, validate;
    if (action === 'maya_chat') {
      const source = Array.isArray(input.messages) ? input.messages.slice(-8) : [];
      if (!source.length || source.some(item => !item || !['user','assistant'].includes(item.role) || typeof item.content !== 'string')) return send(res, 400, { error: 'Provide a short tutor conversation.' });
      const total = source.reduce((sum, item) => sum + item.content.length, 0);
      if (total > 6000) return send(res, 413, { error: 'Tutor messages exceed the allowed length.' });
      messages = [{ role: 'system', content: 'You are Maya, a concise JEE tutor. Explain clearly, ask one follow-up when useful, and do not request personal information.' }, ...source.map(item => ({ role: item.role, content: clean(item.content, 3000) }))];
      validate = output => ({ reply: clean(output, 5000) });
    } else if (action === 'exam_generation') {
      const topic = clean(input.topic, 1000), count = Number(input.count), difficulty = clean(input.difficulty, 20).toLowerCase();
      if (!topic || topic.length > 1000 || !Number.isInteger(count) || count < 1 || count > 20 || !['easy','medium','hard'].includes(difficulty)) return send(res, 400, { error: 'Provide a topic, 1–20 questions and a valid difficulty.' });
      messages = [{ role: 'system', content: 'Return only valid JSON with {"questions":[{"question":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}. Questions must be original JEE practice questions and have exactly four options.' }, { role: 'user', content: `Create ${count} ${difficulty} questions about: ${topic}` }];
      validate = output => {
        const parsed = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (!Array.isArray(parsed.questions) || parsed.questions.length !== count) throw new Error('AI returned an invalid question list.');
        const questions = parsed.questions.map(item => {
          if (typeof item.question !== 'string' || !Array.isArray(item.options) || item.options.length !== 4 || !Number.isInteger(item.answerIndex) || item.answerIndex < 0 || item.answerIndex > 3 || typeof item.explanation !== 'string') throw new Error('AI returned an invalid question.');
          return { question: clean(item.question, 1200), options: item.options.map(option => clean(option, 500)), answerIndex: item.answerIndex, explanation: clean(item.explanation, 1500) };
        });
        return { questions };
      };
    } else {
      const question = clean(input.question, 2000), answer = clean(input.answer, 6000), rubric = clean(input.rubric, 2000);
      if (!question || !answer) return send(res, 400, { error: 'Provide the question and student answer.' });
      messages = [{ role: 'system', content: 'Assess only the supplied academic answer. Return JSON: {"score":0-100,"feedback":"short constructive feedback"}. Do not infer or request student personal information.' }, { role: 'user', content: JSON.stringify({ question, answer, rubric }) }];
      validate = output => { const parsed = JSON.parse(output.replace(/^```(?:json)?\s*|\s*```$/g, '')); const score = Number(parsed.score); if (!Number.isFinite(score) || score < 0 || score > 100 || typeof parsed.feedback !== 'string') throw new Error('AI returned an invalid assessment.'); return { score: Math.round(score), feedback: clean(parsed.feedback, 2000) }; };
    }
    const maxTokens = Math.max(128, Math.min(2500, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 1200));
    const output = await openAiCompletion(provider, messages, maxTokens);
    const result = validate(output);
    await audit(provider, `ai.${action}`, 'success', auth.account.id, 200);
    return send(res, 200, result);
  } catch (error) {
    await audit(provider, `ai.${action}`, 'failed', auth.account.id, Number(error?.status) || 500);
    logError(endpoint, 'provider request or response validation', error);
    return send(res, Number(error?.status) === 429 ? 429 : 502, { error: 'AI request failed. Check the integration connection and try again.' });
  }
}
async function handleCustomAction(req, res, actionId, auth) {
  if (req.method !== 'POST') return null;
  if (limited(req, 'custom-action', 10)) return send(res, 429, { error: 'Too many connector requests. Try again shortly.' });
  const input = await parseInput(req, res, auth.session, 16 * 1024); if (!input) return;
  try {
    const credentials = await getCredentials('custom'), actions = credentials.actions || [];
    const action = actions.find(item => String(item.id || item.name) === actionId);
    if (!action) return send(res, 404, { error: 'Custom action was not found.' });
    const target = new URL(action.path, credentials.baseUrl);
    if (target.origin !== new URL(credentials.baseUrl).origin) throw new Error('Custom action must use the configured connector host.');
    const headers = { 'Content-Type': 'application/json' };
    if (credentials.secret) headers.Authorization = `Bearer ${credentials.secret}`;
    const result = await safeCustomRequest(target.toString(), { method: String(action.method || 'GET').toUpperCase(), headers, body: ['GET','DELETE'].includes(String(action.method || 'GET').toUpperCase()) ? undefined : JSON.stringify(input.payload || {}) });
    await audit('custom', `custom.action.${clean(action.name,60)}`, result.status >= 200 && result.status < 400 ? 'success' : 'failed', auth.account.id, result.status);
    return send(res, 200, { ok: result.status >= 200 && result.status < 400, httpStatus: result.status });
  } catch (error) { await audit('custom','custom.action','failed',auth.account.id,Number(error?.status)||500); logError('/api/admin/integrations/custom/actions','run connector action',error); return send(res, 502, { error: 'Custom connector action failed.' }); }
}

async function testIntegrationHandler(req, res, auth) {
  const input = await parseInput(req, res, auth.session, 16384);
  if (!input) return;

  const provider = String(input.provider || '').trim().toLowerCase();
  const creds = (input.credentials && typeof input.credentials === 'object') ? input.credentials : input;

  if (provider === 'zoom') {
    const accountId = String(creds.accountId || '').trim();
    const clientId = String(creds.clientId || '').trim();
    const clientSecret = String(creds.clientSecret || '').trim();
    const zoomUserEmail = String(creds.zoomUserEmail || '').trim();

    if (!accountId || !clientId || !clientSecret) {
      return send(res, 200, { ok: false, message: 'Account ID, Client ID, and Client Secret are required for Zoom.' });
    }

    try {
      const tokenUrl = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
      });

      const tokenData = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        const errMsg = tokenData.reason || tokenData.error || tokenData.message || `HTTP ${tokenRes.status}`;
        console.error(`[Zoom Test] Token failed: ${errMsg}`);
        return send(res, 200, { ok: false, message: `Zoom authentication failed: ${errMsg}` });
      }

      if (!tokenData.access_token) {
        return send(res, 200, { ok: false, message: 'Zoom did not return an access token.' });
      }

      const userTarget = zoomUserEmail ? encodeURIComponent(zoomUserEmail) : 'me';
      const userRes = await fetch(`https://api.zoom.us/v2/users/${userTarget}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      const userData = await userRes.json().catch(() => ({}));
      if (!userRes.ok) {
        const userErrMsg = userData.message || `HTTP ${userRes.status}`;
        console.error(`[Zoom Test] User check failed: ${userErrMsg}`);
        return send(res, 200, { ok: false, message: `Zoom user verification failed: ${userErrMsg}` });
      }

      return send(res, 200, { ok: true, message: 'Zoom integration verified successfully.' });
    } catch (err) {
      const msg = err.name === 'TimeoutError' ? 'Zoom connection timed out (10s).' : (err.message || 'Zoom connection failed.');
      console.error(`[Zoom Test] Error: ${err.message}`);
      return send(res, 200, { ok: false, message: msg });
    }
  }

  if (provider === 'google_meet') {
    const meetingLink = String(creds.meetingLink || creds.meeting_link || '').trim();
    if (!meetingLink) {
      return send(res, 200, { ok: false, message: 'Meeting Link is required for Google Meet.' });
    }
    const meetRegex = /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}(?:\?.*)?$/i;
    if (!meetRegex.test(meetingLink)) {
      return send(res, 200, { ok: false, message: 'Invalid Google Meet link. Format must be https://meet.google.com/xxx-xxxx-xxx' });
    }
    return send(res, 200, { ok: true, message: 'Google Meet link verified successfully.' });
  }

  return send(res, 200, { ok: false, message: 'Choose a valid provider (Zoom or Google Meet).' });
}

async function handleIntegrationsRoute(req, res, url) {
  const pathname = url.pathname;
  const webhookResult = await handleWhatsAppWebhook(req, res, url);
  if (webhookResult !== null) return webhookResult;
  const relevant = pathname === '/api/integrations/test' || pathname === '/api/admin/integrations/test' || pathname === '/api/admin/integrations' || pathname.startsWith('/api/admin/integrations/') || pathname.startsWith('/api/admin/proctoring/') || pathname.startsWith('/api/admin/ai/');
  if (!relevant) return null;
  let auth;
  try { auth = await authenticate(req); }
  catch (error) { logError(pathname,'authenticate admin',error); return send(res,503,{error:'Account storage is unavailable.'}); }
  if (auth.error) return send(res,auth.error.status,{error:auth.error.message});

  if ((pathname === '/api/integrations/test' || pathname === '/api/admin/integrations/test') && req.method === 'POST') {
    return testIntegrationHandler(req, res, auth);
  }

  if ((pathname === '/api/admin/integrations' || pathname === '/api/admin/integrations/status') && req.method === 'GET') {
    try {
      if (statusCache && statusCache.expiresAt > Date.now()) return send(res,200,statusCache.value);
      const value = await loadStatuses();
      statusCache = { value, expiresAt: Date.now() + CACHE_MS };
      if (pathname.endsWith('/status')) return send(res,200,{ providers: { zoom: value.integrations.zoom.connected, google_meet: value.integrations.google_meet.connected, teams: value.integrations.teams.connected } });
      return send(res,200,value);
    } catch (error) { logError(pathname,'load integration status',error); return send(res,500,{error:'Integration settings could not be loaded.'}); }
  }

  if (pathname === '/api/admin/proctoring/config' && req.method === 'GET') return send(res,200,await getProctoringConfig());
  if (pathname === '/api/admin/proctoring/session' && req.method === 'POST') {
    if (limited(req,'proctoring-session',10)) return send(res,429,{error:'Too many proctoring sessions requested.'});
    const input = await parseInput(req,res,auth.session,4096); if (!input) return;
    const sessionId = clean(input.sessionId || id(),120);
    try { const result = await createProctoringSessionToken(sessionId); await audit('video_proctoring','session.created','success',auth.account.id,200); return send(res,200,{sessionId,sessionToken:result.token,expiresAt:result.expiresAt}); }
    catch (error) { await audit('video_proctoring','session.created','failed',auth.account.id,502); logError(pathname,'create provider session token',error); return send(res,502,{error:'Proctoring session could not be created.'}); }
  }

  const aiMatch = pathname.match(/^\/api\/admin\/(?:integrations\/ai|ai)\/(maya_chat|exam_generation|assessment)$/);
  if (aiMatch) return handleAi(req,res,aiMatch[1],auth);
  const customActionMatch = pathname.match(/^\/api\/admin\/integrations\/custom\/actions\/([^/]+)$/);
  if (customActionMatch) return handleCustomAction(req,res,decodeURIComponent(customActionMatch[1]),auth);

  if (pathname === '/api/admin/integrations/api_access/tokens' && req.method === 'GET') {
    try { const { rows } = await queryWithLimit(() => getPool().query('select id,token_name,created_at,last_used_at from public.integration_api_tokens where revoked_at is null order by created_at desc')); return send(res,200,{tokens:rows}); }
    catch (error) { logError(pathname,'list API tokens',error); return send(res,500,{error:'API tokens could not be loaded.'}); }
  }
  if (pathname === '/api/admin/integrations/api_access/tokens' && req.method === 'POST') return createApiToken(req,res,auth);
  const revokeMatch = pathname.match(/^\/api\/admin\/integrations\/api_access\/tokens\/([^/]+)$/);
  if (revokeMatch && req.method === 'DELETE') {
    if (!validCsrfRequest(req,auth.session)) return send(res,403,{error:'CSRF validation failed.'});
    try { const result = await queryWithLimit(() => getPool().query('update public.integration_api_tokens set revoked_at=now() where id=$1 and revoked_at is null returning id',[decodeURIComponent(revokeMatch[1])])); if (!result.rowCount) return send(res,404,{error:'API token was not found.'}); await audit('api_access','token.revoked','success',auth.account.id); return send(res,200,{ok:true}); }
    catch (error) { logError(pathname,'revoke API token',error); return send(res,500,{error:'API token could not be revoked.'}); }
  }

  const route = parseProvider(pathname);
  if (!route) return send(res,404,{error:'Integration endpoint was not found.'});
  const { provider, action } = route;
  if (provider === 'api_access' && action === 'tokens') return send(res,405,{error:'Use the API token endpoint.'});
  if (req.method === 'PUT' && !action) {
    const input = await parseInput(req,res,auth.session,32 * 1024); if (!input) return;
    const enabled = input.enabled === true;
    try {
      const previous = await findConnection(provider);
      const credentials = cleanCredentials(provider,input.credentials || {},previous?.credentials || {});
      validateProvider(provider,credentials,enabled);
      try { await saveWithConnectionCheck(provider,credentials,enabled,testIntegration,() => persistConnection(provider,credentials,enabled,auth.account.id)); }
      catch (error) {
        if (error.code === 'INTEGRATION_CREDENTIALS_MISSING') return send(res,400,{error:error.message});
        if (error.integrationTestFailure) {
          logError(pathname,'test submitted provider credentials',error);
          return send(res,502,{error:provider === 'zoom' ? error.message : 'Connection test failed. The integration was not enabled; check credentials and provider permissions.'});
        }
        throw error;
      }
      return send(res,200,{provider,enabled,saved:true});
    } catch (error) { logError(pathname,'validate or save encrypted credentials',error); return send(res,400,{error:error.code==='INTEGRATIONS_KEY_INVALID'?'Integration encryption is not configured on the server.':error.message || 'Integration settings could not be saved.'}); }
  }
  if (action === 'test' && req.method === 'POST') {
    if (limited(req,`integration-test-${provider}`,8)) return send(res,429,{error:'Too many connection tests. Try again shortly.'});
    if (!validCsrfRequest(req,auth.session)) return send(res,403,{error:'CSRF validation failed.'});
    try {
      const existing = await findConnection(provider);
      const credentials = existing?.credentials || {};
      validateProvider(provider,credentials,false);
      const result = await testIntegration(provider,credentials);
      await audit(provider,'connection.tested','success',auth.account.id,200);
      return send(res,200,{ok:true,message:result.message || 'Connection verified.'});
    } catch (error) { await audit(provider,'connection.tested','failed',auth.account.id,Number(error?.status)||502); logError(pathname,'test provider connection',error); return send(res,502,{ok:false,error:provider === 'zoom' ? error.message : 'Connection test failed. Check saved settings and provider permissions.'}); }
  }
  if (!action && req.method === 'DELETE') {
    if (!validCsrfRequest(req,auth.session)) return send(res,403,{error:'CSRF validation failed.'});
    try {
      await queryWithLimit(() => getPool().query('delete from public.integration_connections where provider=$1',[provider]));
      if (provider === 'api_access') await queryWithLimit(() => getPool().query('update public.integration_api_tokens set revoked_at=coalesce(revoked_at,now()) where revoked_at is null'));
      await audit(provider,'credentials.removed','success',auth.account.id);
      return send(res,200,{ok:true});
    } catch (error) { logError(pathname,'remove saved credentials',error); return send(res,500,{error:'Saved integration credentials could not be removed.'}); }
  }
  if (provider === 'priority_support' && !action && req.method === 'POST') return send(res,405,{error:'Priority support is configured by the server operator.'});
  return send(res,405,{error:'Method not allowed.'});
}

module.exports = { handleIntegrationsRoute, safeEqualText, safeConfig, credentialsPresent, saveWithConnectionCheck, verifyWhatsAppSignature, recordWhatsAppMessage };
