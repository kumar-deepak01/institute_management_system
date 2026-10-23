'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');
const { google } = require('googleapis');
const { getPool } = require('./postgresStore');
const { decryptIntegrationValue } = require('./integrationVault');

const withTimeout = (ms = 10000) => AbortSignal.timeout(Math.max(1000, Math.min(60000, ms)));
async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`Provider returned HTTP ${response.status}.`), { status: response.status });
  return payload;
}
function zoomFailure(response, payload, stage) {
  const providerCode = typeof payload?.error === 'string' ? payload.error : (Number.isInteger(payload?.code) ? String(payload.code) : '');
  let message;
  if (stage === 'token' && providerCode === 'unsupported_grant_type') {
    message = 'Zoom rejected the account_credentials grant. Use credentials from a Server-to-Server OAuth app; General OAuth credentials do not work with this connection.';
  } else if (stage === 'token' && providerCode === 'invalid_client') {
    message = 'Zoom rejected the Client ID or Client Secret. Check the credentials on the Server-to-Server OAuth app.';
  } else if (stage === 'token' && (response.status === 400 || response.status === 401)) {
    message = 'Zoom could not issue a Server-to-Server token. Check the app type, Account ID, Client ID and Client Secret, and confirm the app is activated.';
  } else if (stage === 'api' && response.status === 403) {
    message = 'Zoom authenticated the app but denied API access. Enable Zoom REST API access and grant the app user-read and meeting-write scopes.';
  } else if (stage === 'api' && response.status === 401) {
    message = 'Zoom did not accept the access token. Confirm the Server-to-Server app is active and its scopes are authorized.';
  } else if (stage === 'api' && response.status === 404) {
    message = 'Zoom could not find the configured Account Email in this account. Use an active Zoom user email that can host meetings.';
  } else if (stage === 'api' && response.status === 429) {
    message = 'Zoom is rate-limiting connection checks. Wait briefly, then test again.';
  } else {
    message = `Zoom ${stage === 'token' ? 'token request' : 'account check'} failed (HTTP ${response.status}). Check the Server-to-Server app settings and try again.`;
  }
  const code = providerCode ? `ZOOM_${providerCode.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 32)}` : `ZOOM_HTTP_${response.status}`;
  return Object.assign(new Error(message), { status: response.status, code });
}
async function readZoomJson(response, stage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw zoomFailure(response, payload, stage);
  return payload;
}
async function zoomApiJson(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: withTimeout(), redirect: 'error' });
  return readZoomJson(response, 'api');
}
async function fetchJson(url, options = {}, timeout = 10000) {
  const response = await fetch(url, { ...options, signal: withTimeout(timeout), redirect: 'error' });
  return readJson(response);
}
async function getCredentials(provider) {
  const { rows } = await getPool().query('select credentials_encrypted,connected from public.integration_connections where provider=$1 limit 1', [provider]);
  if (!rows[0]?.connected || !rows[0]?.credentials_encrypted) throw Object.assign(new Error('Integration is not enabled or has no saved credentials.'), { code: 'INTEGRATION_NOT_CONFIGURED' });
  return decryptIntegrationValue(rows[0].credentials_encrypted);
}

async function zoomToken(credentials) {
  const body = new URLSearchParams({ grant_type: 'account_credentials', account_id: credentials.accountId });
  const response = await fetch('https://zoom.us/oauth/token', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: withTimeout(), redirect: 'error' });
  return readZoomJson(response, 'token');
}
function googleCalendarClient(credentials) {
  if (credentials.authType === 'service_account') {
    let serviceAccount;
    try { serviceAccount = JSON.parse(credentials.serviceAccountJson); } catch { throw new Error('Service account JSON is not valid JSON.'); }
    if (!serviceAccount.client_email || !serviceAccount.private_key) throw new Error('Service account JSON is missing required fields.');
    return new google.auth.JWT({ email: serviceAccount.client_email, key: serviceAccount.private_key, scopes: ['https://www.googleapis.com/auth/calendar'] });
  }
  const oauth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth.setCredentials({ refresh_token: credentials.refreshToken });
  return oauth;
}
async function graphToken(credentials) {
  const params = new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' });
  return fetchJson(`https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
}

function ipv4Public(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}
function ipv6Public(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return false;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? ipv4Public(mapped[1]) : true;
}
async function validatePublicHttpsUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Custom connector URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Custom connectors require a public HTTPS URL on port 443.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Private network destinations are not allowed.');
  if (net.isIP(hostname)) {
    if (!(net.isIPv4(hostname) ? ipv4Public(hostname) : ipv6Public(hostname))) throw new Error('Private network destinations are not allowed.');
    return { url, address: hostname, family: net.isIPv4(hostname) ? 4 : 6 };
  }
  let addresses;
  try { addresses = await dns.lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new Error('Custom connector hostname could not be resolved.'); }
  if (!addresses.length || addresses.some(item => !(item.family === 4 ? ipv4Public(item.address) : ipv6Public(item.address)))) throw new Error('Custom connector must resolve only to public addresses.');
  return { url, address: addresses[0].address, family: addresses[0].family };
}
async function safeCustomRequest(rawUrl, { method = 'GET', headers = {}, body } = {}) {
  const { url, address, family } = await validatePublicHttpsUrl(rawUrl);
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method, headers, servername: url.hostname, timeout: 8000, lookup: (_hostname, _options, callback) => callback(null, address, family) }, response => {
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) request.destroy(new Error('Custom connector response exceeded the size limit.')); else chunks.push(chunk); });
      response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('Custom connector timed out.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function testIntegration(provider, credentials) {
  if (provider === 'zoom') {
    const token = await zoomToken(credentials);
    const scopes = Array.isArray(token.scope) ? token.scope : String(token.scope || '').split(/[\s,]+/).filter(Boolean);
    const canReadUser = scopes.includes('user:read:user:admin') || scopes.includes('user:read:admin') || scopes.includes('user:read');
    const canCreateMeetings = scopes.includes('meeting:write:meeting:admin') || scopes.includes('meeting:write:meeting') || scopes.includes('meeting:write:admin') || scopes.includes('meeting:write');
    if (!canReadUser || !canCreateMeetings) {
      throw Object.assign(new Error(`Zoom token is valid, but required scopes are missing. Add ${[!canReadUser ? 'user:read:user:admin (or user:read:admin)' : '', !canCreateMeetings ? 'meeting:write:meeting:admin (or meeting:write:meeting)' : ''].filter(Boolean).join(' and ')} to the Server-to-Server app, then activate it.`), { code: 'ZOOM_SCOPES_MISSING', status: 403 });
    }
    await zoomApiJson(`https://api.zoom.us/v2/users/${encodeURIComponent(credentials.accountEmail)}`, token.access_token);
  } else if (provider === 'google_meet') {
    const auth = googleCalendarClient(credentials);
    await auth.authorize();
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.list({ calendarId: credentials.calendarId, maxResults: 1, timeMin: new Date().toISOString() });
  } else if (provider === 'teams') {
    const token = await graphToken(credentials);
    await fetchJson(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(credentials.organizer)}`, { headers: { Authorization: `Bearer ${token.access_token}` } });
  } else if (provider === 'whatsapp') {
    if (!process.env.WHATSAPP_APP_SECRET) throw new Error('WhatsApp webhook signing is not configured on the server.');
    await fetchJson(`https://graph.facebook.com/v22.0/${encodeURIComponent(credentials.phoneNumberId)}?fields=id,display_phone_number`, { headers: { Authorization: `Bearer ${credentials.accessToken}` } });
  } else if (provider === 'email') {
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({ host: credentials.host, port: Number(credentials.port), secure: Boolean(credentials.secure), auth: { user: credentials.username, pass: credentials.password }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 });
    await transport.verify();
    transport.close();
  } else if (provider === 'sms') {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(credentials.accountSid)}.json`, { headers: { Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}` }, signal: withTimeout(), redirect: 'error' });
    await readJson(response);
  } else if (['maya_ai', 'ai_exam_generation', 'ai_assessment'].includes(provider)) {
    await fetchJson('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${credentials.apiKey}` } });
  } else if (provider === 'video_proctoring') {
    if (!credentials.apiBaseUrl) throw new Error('Provider credentials saved; set a public API base URL to test this adapter.');
    const result = await safeCustomRequest(new URL('health', credentials.apiBaseUrl.endsWith('/') ? credentials.apiBaseUrl : `${credentials.apiBaseUrl}/`).toString(), { headers: { Authorization: `Bearer ${credentials.apiKey}` } });
    if (result.status < 200 || result.status >= 300) throw Object.assign(new Error(`Proctoring provider returned HTTP ${result.status}.`), { status: result.status });
  } else if (provider === 'custom') {
    const result = await safeCustomRequest(credentials.baseUrl, { method: 'GET', headers: credentials.secret ? { Authorization: `Bearer ${credentials.secret}` } : {} });
    if (result.status < 200 || result.status >= 400) throw Object.assign(new Error(`Custom connector returned HTTP ${result.status}.`), { status: result.status });
  } else if (provider === 'api_access') {
    return { message: 'API token storage is available.' };
  } else if (provider === 'priority_support') {
    if (!process.env.PRIORITY_SUPPORT_EMAIL && !process.env.PRIORITY_SUPPORT_PHONE) throw new Error('Priority support contact is not configured.');
    return { message: 'Priority support contact is configured.' };
  } else throw new Error('This provider does not support a connection test.');
  return { message: 'Connection verified.' };
}

async function createMeeting(provider, details) {
  const credentials = await getCredentials(provider);
  if (provider === 'zoom') {
    const token = await zoomToken(credentials);
    const user = credentials.accountEmail || 'me';
    const response = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(user)}/meetings`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: details.title, type: 2, start_time: details.scheduledAt, duration: details.durationMinutes, settings: { waiting_room: true } }), signal: withTimeout(), redirect: 'error',
    });
    const result = await readZoomJson(response, 'api');
    return { meetingId: String(result.id), meetingUrl: result.join_url, hostUrl: result.start_url || result.join_url, calendarId: null };
  }
  if (provider === 'google_meet') {
    const auth = googleCalendarClient(credentials);
    const calendar = google.calendar({ version: 'v3', auth });
    const end = new Date(new Date(details.scheduledAt).getTime() + details.durationMinutes * 60000).toISOString();
    const result = await calendar.events.insert({ calendarId: credentials.calendarId, conferenceDataVersion: 1, requestBody: {
      summary: details.title, description: details.topic || '', start: { dateTime: details.scheduledAt }, end: { dateTime: end },
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    } });
    const joinUrl = result.data.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri;
    if (!joinUrl) throw new Error('Google Calendar did not return a Meet link.');
    return { meetingId: result.data.id, meetingUrl: joinUrl, hostUrl: result.data.htmlLink || joinUrl, calendarId: credentials.calendarId };
  }
  if (provider === 'teams') {
    const token = await graphToken(credentials);
    const end = new Date(new Date(details.scheduledAt).getTime() + details.durationMinutes * 60000).toISOString();
    const result = await fetchJson(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(credentials.organizer)}/onlineMeetings`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject: details.title, startDateTime: details.scheduledAt, endDateTime: end }),
    });
    return { meetingId: result.id, meetingUrl: result.joinWebUrl, hostUrl: result.joinWebUrl, calendarId: credentials.organizer };
  }
  return { meetingId: null, meetingUrl: details.meetingUrl || null, hostUrl: null, calendarId: null };
}

async function updateMeeting(provider, meeting, details) {
  const credentials = await getCredentials(provider);
  if (!meeting.meetingId) throw new Error('The provider meeting identifier is missing.');
  if (provider === 'zoom') {
    const token = await zoomToken(credentials);
    await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meeting.meetingId)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ topic: details.title, start_time: details.scheduledAt, duration: details.durationMinutes }) });
  } else if (provider === 'google_meet') {
    const auth = googleCalendarClient(credentials), calendar = google.calendar({ version: 'v3', auth });
    const calendarId = meeting.calendarId || credentials.calendarId;
    const event = (await calendar.events.get({ calendarId, eventId: meeting.meetingId })).data;
    event.summary = details.title; event.description = details.topic || '';
    event.start = { dateTime: details.scheduledAt };
    event.end = { dateTime: new Date(new Date(details.scheduledAt).getTime() + details.durationMinutes * 60000).toISOString() };
    const updated = (await calendar.events.update({ calendarId, eventId: meeting.meetingId, conferenceDataVersion: 1, requestBody: event })).data;
    return { meetingId: updated.id, meetingUrl: updated.conferenceData?.entryPoints?.find(item => item.entryPointType === 'video')?.uri || meeting.meetingUrl, hostUrl: updated.htmlLink || meeting.hostUrl, calendarId };
  } else if (provider === 'teams') {
    const token = await graphToken(credentials), organizer = meeting.calendarId || credentials.organizer;
    const end = new Date(new Date(details.scheduledAt).getTime() + details.durationMinutes * 60000).toISOString();
    const result = await fetchJson(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizer)}/onlineMeetings/${encodeURIComponent(meeting.meetingId)}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: details.title, startDateTime: details.scheduledAt, endDateTime: end }) });
    return { meetingId: meeting.meetingId, meetingUrl: result.joinWebUrl || meeting.meetingUrl, hostUrl: result.joinWebUrl || meeting.hostUrl, calendarId: organizer };
  }
  return meeting;
}

async function deleteMeeting(provider, meeting) {
  const credentials = await getCredentials(provider);
  if (!meeting.meetingId) return;
  if (provider === 'zoom') {
    const token = await zoomToken(credentials);
    const response = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(meeting.meetingId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.access_token}` }, signal: withTimeout(), redirect: 'error' });
    if (!response.ok && response.status !== 404) throw Object.assign(new Error(`Provider returned HTTP ${response.status}.`), { status: response.status });
  } else if (provider === 'google_meet') {
    const auth = googleCalendarClient(credentials), calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({ calendarId: meeting.calendarId || credentials.calendarId, eventId: meeting.meetingId });
  } else if (provider === 'teams') {
    const token = await graphToken(credentials), organizer = meeting.calendarId || credentials.organizer;
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizer)}/onlineMeetings/${encodeURIComponent(meeting.meetingId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.access_token}` }, signal: withTimeout(), redirect: 'error' });
    if (!response.ok && response.status !== 404) throw Object.assign(new Error(`Provider returned HTTP ${response.status}.`), { status: response.status });
  }
}

async function performMeetingAction(action, provider, meeting, details, adapters = {}) {
  const methods = { create: adapters.create || createMeeting, update: adapters.update || updateMeeting, delete: adapters.delete || deleteMeeting };
  const method = methods[action];
  if (!method) throw new Error('Unsupported meeting action.');
  return action === 'create' ? method(provider, details) : action === 'update' ? method(provider, meeting, details) : method(provider, meeting);
}

async function getProctoringConfig() {
  try {
    const credentials = await getCredentials('video_proctoring');
    const allowed = new Set(['recording', 'identityCheck', 'screenShare', 'browserLock', 'audioCapture', 'videoCapture', 'requireFullscreen', 'allowMobile']);
    const settings = credentials.settings && typeof credentials.settings === 'object' && !Array.isArray(credentials.settings)
      ? Object.fromEntries(Object.entries(credentials.settings).filter(([key, value]) => allowed.has(key) && ['boolean', 'number', 'string'].includes(typeof value)).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value]))
      : {};
    return { enabled: true, provider: credentials.provider || 'custom', settings };
  } catch { return { enabled: false, provider: '', options: {} }; }
}
async function createProctoringSessionToken(sessionId) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(String(sessionId || ''))) throw new Error('Proctoring session identifier is invalid.');
  const credentials = await getCredentials('video_proctoring');
  if (!credentials.apiKey || !credentials.apiBaseUrl) throw new Error('Proctoring provider session endpoint is not configured.');
  const target = new URL('sessions', credentials.apiBaseUrl.endsWith('/') ? credentials.apiBaseUrl : `${credentials.apiBaseUrl}/`).toString();
  const response = await safeCustomRequest(target, { method: 'POST', headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, expiresIn: 900 }) });
  if (response.status < 200 || response.status >= 300) throw Object.assign(new Error(`Proctoring provider returned HTTP ${response.status}.`), { status: response.status });
  let payload;
  try { payload = JSON.parse(response.body || '{}'); } catch { throw new Error('Proctoring provider returned an invalid session response.'); }
  const token = typeof payload.sessionToken === 'string' ? payload.sessionToken : typeof payload.token === 'string' ? payload.token : '';
  if (!token || token.length > 8192) throw new Error('Proctoring provider response did not include a valid session token.');
  return { token, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
}

async function openAiCompletion(provider, messages, maxTokens) {
  const credentials = await getCredentials(provider);
  const response = await fetchJson('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${credentials.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: credentials.model || 'gpt-4o-mini', messages, max_tokens: maxTokens, temperature: 0.3 }) }, Number(process.env.AI_REQUEST_TIMEOUT_MS) || 20000);
  return String(response.choices?.[0]?.message?.content || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
}

module.exports = { getCredentials, testIntegration, createMeeting, updateMeeting, deleteMeeting, performMeetingAction, getProctoringConfig, createProctoringSessionToken, openAiCompletion, safeCustomRequest };
