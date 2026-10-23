'use strict';

const crypto = require('node:crypto');
const { z } = require('zod');
const { getPool } = require('../services/postgresStore');
const { queryWithLimit } = require('../services/queryConcurrency');
const { getSession, validCsrfRequest } = require('../middleware/auth');
const { resolveSessionAccount } = require('./apiController');
const { body, json } = require('../middleware/http');
const { performMeetingAction } = require('../services/integrationProviders');

const send = (res, status, value) => json(res, status, value);
const id = () => crypto.randomUUID();
const clean = (value, max) => String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const inputSchema = z.object({
  title: z.string().trim().min(2).max(160), notes: z.string().max(3000).optional().default(''),
  provider: z.enum(['zoom','google_meet','in_person']), batchId: z.string().min(1).max(160),
  teacherId: z.string().min(1).max(160), audience: z.enum(['parents','students_and_parents']),
  scheduledAt: z.string().datetime({ offset: true }), durationMinutes: z.coerce.number().int().min(10).max(240).default(30),
});
const logFailure = (endpoint, step, error) => {
  const code = String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);
  const message = String(error?.message || 'Unknown error').replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '[redacted]')
    .replace(/\b(password|hash|cookie|authorization|database_url|secret|token|key|credentials)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 260);
  console.error(`[ptm] endpoint=${endpoint} step=${step} code=${code} message=${message}`);
};
async function authenticate(req, roles) {
  const session = getSession(req);
  if (!session) return { error: { status: 401, message: 'Sign in required.' } };
  const account = await resolveSessionAccount(req);
  if (!account) return { error: { status: 401, message: 'Sign in required.' } };
  if (!roles.includes(account.role)) return { error: { status: 403, message: 'You do not have access to these meeting notices.' } };
  return { session, account };
}
async function parseInput(req, res, session) {
  if (!validCsrfRequest(req, session)) { send(res, 403, { error: 'CSRF validation failed.' }); return null; }
  try {
    const raw = await body(req, 12 * 1024);
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) { send(res, 400, { error: 'Enter valid meeting details.' }); return null; }
    return { ...parsed.data, title: clean(parsed.data.title, 160), notes: clean(parsed.data.notes, 3000) };
  } catch { send(res, 400, { error: 'Invalid request body.' }); return null; }
}
async function getTeacher(teacherId) {
  const result = await queryWithLimit(() => getPool().query(`select s.id,s.staff_key,s.name,s.status,a.id as account_id
    from public.staff s join public.accounts a on a.student_id=s.id and a.role='teacher'
    where s.id=$1 and lower(coalesce(s.status,'active'))='active' limit 1`, [teacherId]));
  return result.rows[0] || null;
}
async function buildRecipients(client, session) {
  const recipients = await client.query(`select a.id as account_id,a.role,s.id as student_id,null::uuid as staff_key
    from public.students s join public.accounts a on a.student_id=s.id
    where s.batch_id=$1 and a.role=any($2::text[])
    union all
    select a.id,'teacher',null::text,s.staff_key
    from public.staff s join public.accounts a on a.student_id=s.id and a.role='teacher'
    where s.id=$3`, [session.batch_id, session.audience === 'parents' ? ['parent'] : ['parent','student'], session.teacher_staff_id]);
  for (const recipient of recipients.rows) {
    await client.query(`insert into public.ptm_recipient_notices(id,session_id,recipient_account_id,recipient_role,student_key,staff_key)
      values($1,$2,$3,$4,$5,$6) on conflict(session_id,recipient_account_id) do nothing`, [id(), session.id, recipient.account_id, recipient.role, recipient.student_id, recipient.staff_key]);
  }
  return recipients.rowCount;
}
function meetingLinkForRole(role, status, joinUrl, hostUrl) {
  if (status !== 'scheduled') return null;
  if (role === 'teacher') return hostUrl || null;
  if (role === 'student' || role === 'parent') return joinUrl || null;
  return null;
}
async function transaction(task) {
  const client = await getPool().connect();
  try { await client.query('begin'); const result = await task(client); await client.query('commit'); return result; }
  catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
function toMeeting(row) { return { meetingId: row.provider_meeting_id, meetingUrl: row.join_url, hostUrl: row.host_url, calendarId: row.provider_calendar_id }; }
async function persistCreate(account, input) {
  const batch = (await queryWithLimit(() => getPool().query('select id,name from public.batches where id=$1 and coalesce(active,true)=true limit 1', [input.batchId]))).rows[0];
  if (!batch) throw Object.assign(new Error('Choose an active batch.'), { status: 400 });
  const teacher = await getTeacher(input.teacherId);
  if (!teacher) throw Object.assign(new Error('Choose an active teacher with a login account.'), { status: 400 });
  let meeting = { meetingId: null, meetingUrl: null, hostUrl: null, calendarId: null };
  if (input.provider !== 'in_person') meeting = await performMeetingAction('create',input.provider,null,{ title: input.title, topic: input.notes, scheduledAt: input.scheduledAt, durationMinutes: input.durationMinutes });
  const session = { id: id(), title: input.title, notes: input.notes, provider: input.provider, batch_id: batch.id, batch_name: batch.name, teacher_staff_id: teacher.id, teacher_name: teacher.name,
    teacher_staff_key: teacher.staff_key, audience: input.audience, scheduled_at: input.scheduledAt, duration_minutes: input.durationMinutes,
    status: 'scheduled', provider_meeting_id: meeting.meetingId, join_url: meeting.meetingUrl, host_url: meeting.hostUrl,
    provider_calendar_id: meeting.calendarId, created_by: account.id };
  try {
    const recipientCount = await transaction(async client => {
      await client.query(`insert into public.ptm_sessions(id,title,notes,provider,batch_id,batch_name,teacher_staff_id,teacher_staff_key,teacher_name,audience,scheduled_at,duration_minutes,status,provider_meeting_id,join_url,host_url,provider_calendar_id,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`, [session.id,session.title,session.notes,session.provider,session.batch_id,session.batch_name,session.teacher_staff_id,session.teacher_staff_key,session.teacher_name,session.audience,session.scheduled_at,session.duration_minutes,session.status,session.provider_meeting_id,session.join_url,session.host_url,session.provider_calendar_id,session.created_by]);
      return buildRecipients(client, session);
    });
    return { session: { ...session, recipientCount }, meeting };
  } catch (error) {
    if (meeting.meetingId) await performMeetingAction('delete',input.provider,meeting).catch(cleanupError => logFailure('/api/admin/ptm','cleanup provider meeting after save failure',cleanupError));
    throw error;
  }
}
async function listAdmin(res) {
  const [sessions, batches, teachers] = await Promise.all([
    queryWithLimit(() => getPool().query(`select p.id,p.title,p.notes,p.provider,p.batch_id,p.batch_name,p.teacher_staff_id,p.teacher_name,p.audience,p.scheduled_at,p.duration_minutes,p.status,p.join_url,p.host_url,p.created_at,
      (select count(*)::int from public.ptm_recipient_notices n where n.session_id=p.id) as recipient_count
      from public.ptm_sessions p order by p.scheduled_at desc limit 100`)),
    queryWithLimit(() => getPool().query('select id,name from public.batches where coalesce(active,true)=true order by name')),
    queryWithLimit(() => getPool().query(`select s.id,s.name,s.staff_type from public.staff s join public.accounts a on a.student_id=s.id and a.role='teacher' where lower(coalesce(s.status,'active'))='active' order by s.name`)),
  ]);
  return send(res,200,{sessions:sessions.rows.map(row=>({...row,recipientCount:Number(row.recipient_count)||0})),batches:batches.rows,teachers:teachers.rows});
}
async function portalNotices(res, account) {
  const { rows } = await queryWithLimit(() => getPool().query(`select n.id,n.recipient_role,p.id as session_id,p.title,p.notes,p.provider,p.batch_name,p.teacher_name,p.scheduled_at,p.duration_minutes,p.status,p.join_url,p.host_url
    from public.ptm_recipient_notices n join public.ptm_sessions p on p.id=n.session_id
    where n.recipient_account_id=$1 order by p.scheduled_at desc limit 100`, [account.id]));
  return send(res,200,{meetings:rows.map(row=>({...row,meeting_url:meetingLinkForRole(row.recipient_role,row.status,row.join_url,row.host_url)}))});
}
async function handlePtmRoute(req, res, url) {
  const path = url.pathname;
  if (!['/api/admin/ptm','/api/portal/ptm'].includes(path) && !path.startsWith('/api/admin/ptm/')) return null;
  const endpoint = path.replace(/\/$/,'');
  let auth;
  try { auth = await authenticate(req, endpoint === '/api/portal/ptm' ? ['student','parent','teacher'] : ['admin']); }
  catch (error) { logFailure(endpoint,'authenticate',error); return send(res,503,{error:'Account storage is unavailable.'}); }
  if (auth.error) return send(res,auth.error.status,{error:auth.error.message});
  if (endpoint === '/api/portal/ptm' && req.method === 'GET') {
    try { return await portalNotices(res,auth.account); } catch (error) { logFailure(endpoint,'load visible recipient notices',error); return send(res,500,{error:'Meeting notices could not be loaded.'}); }
  }
  if (endpoint === '/api/admin/ptm' && req.method === 'GET') {
    try { return await listAdmin(res); } catch (error) { logFailure(endpoint,'load sessions and lookups',error); return send(res,500,{error:'Parent meetings could not be loaded.'}); }
  }
  if (endpoint === '/api/admin/ptm' && req.method === 'POST') {
    const input = await parseInput(req,res,auth.session); if (!input) return;
    try { const result = await persistCreate(auth.account,input); return send(res,201,{session:result.session}); }
    catch (error) { logFailure(endpoint,'create session and recipient notices',error); return send(res,Number(error.status)||502,{error:error.status===400?error.message:'Parent meeting could not be created.'}); }
  }
  const match = endpoint.match(/^\/api\/admin\/ptm\/([^/]+)$/);
  if (match && ['PATCH','DELETE'].includes(req.method)) {
    if (!validCsrfRequest(req,auth.session)) return send(res,403,{error:'CSRF validation failed.'});
    const sessionId = decodeURIComponent(match[1]);
    try {
      const current = (await queryWithLimit(() => getPool().query('select * from public.ptm_sessions where id=$1 limit 1',[sessionId]))).rows[0];
      if (!current) return send(res,404,{error:'Parent meeting was not found.'});
      if (req.method === 'DELETE') {
        await queryWithLimit(() => getPool().query(`update public.ptm_sessions set status='cancelled',join_url=null,host_url=null,cancelled_at=coalesce(cancelled_at,now()),updated_at=now() where id=$1`,[sessionId]));
        if (current.status !== 'cancelled' && current.provider_meeting_id) {
          await performMeetingAction('delete',current.provider,toMeeting(current)).catch(error=>logFailure(endpoint,'delete cancelled provider meeting',error));
        }
        return send(res,200,{ok:true});
      }
      const input = await parseInput(req,res,auth.session); if (!input) return;
      if (current.status === 'cancelled') return send(res,409,{error:'Cancelled meetings cannot be edited.'});
      const batch = (await queryWithLimit(() => getPool().query('select id,name from public.batches where id=$1 and coalesce(active,true)=true limit 1',[input.batchId]))).rows[0];
      const teacher = await getTeacher(input.teacherId);
      if (!batch || !teacher) return send(res,400,{error:'Choose an active batch and teacher.'});
      let meeting = { meetingId: null, meetingUrl: null, hostUrl: null, calendarId: null };
      let createdReplacement = false;
      if (input.provider !== 'in_person') {
        meeting = input.provider === current.provider && current.provider_meeting_id
          ? await performMeetingAction('update',input.provider,toMeeting(current),{title:input.title,topic:input.notes,scheduledAt:input.scheduledAt,durationMinutes:input.durationMinutes})
          : await performMeetingAction('create',input.provider,null,{title:input.title,topic:input.notes,scheduledAt:input.scheduledAt,durationMinutes:input.durationMinutes});
        createdReplacement = !(input.provider === current.provider && current.provider_meeting_id);
      }
      const updated = { ...current,title:input.title,notes:input.notes,provider:input.provider,batch_id:batch.id,batch_name:batch.name,teacher_staff_id:teacher.id,teacher_staff_key:teacher.staff_key,teacher_name:teacher.name,
        audience:input.audience,scheduled_at:input.scheduledAt,duration_minutes:input.durationMinutes,provider_meeting_id:meeting.meetingId,join_url:meeting.meetingUrl,host_url:meeting.hostUrl,provider_calendar_id:meeting.calendarId };
      let recipientCount;
      try {
        recipientCount = await transaction(async client => {
          await client.query(`update public.ptm_sessions set title=$2,notes=$3,provider=$4,batch_id=$5,batch_name=$6,teacher_staff_id=$7,teacher_staff_key=$8,teacher_name=$9,audience=$10,scheduled_at=$11,duration_minutes=$12,provider_meeting_id=$13,join_url=$14,host_url=$15,provider_calendar_id=$16,updated_at=now() where id=$1`,[sessionId,updated.title,updated.notes,updated.provider,updated.batch_id,updated.batch_name,updated.teacher_staff_id,updated.teacher_staff_key,updated.teacher_name,updated.audience,updated.scheduled_at,updated.duration_minutes,updated.provider_meeting_id,updated.join_url,updated.host_url,updated.provider_calendar_id]);
          await client.query('delete from public.ptm_recipient_notices where session_id=$1',[sessionId]);
          return buildRecipients(client,updated);
        });
      } catch (error) {
        if (createdReplacement && meeting.meetingId) await performMeetingAction('delete',input.provider,meeting).catch(cleanupError=>logFailure(endpoint,'cleanup replacement provider meeting',cleanupError));
        throw error;
      }
      if (input.provider !== current.provider && current.provider_meeting_id) {
        await performMeetingAction('delete',current.provider,toMeeting(current)).catch(error=>logFailure(endpoint,'remove replaced provider meeting',error));
      }
      return send(res,200,{ok:true,recipientCount});
    } catch (error) { logFailure(endpoint,req.method==='DELETE'?'cancel session':'update session and notices',error); return send(res,500,{error:'Parent meeting could not be updated.'}); }
  }
  return send(res,405,{error:'Method not allowed.'});
}

module.exports = { handlePtmRoute, buildRecipients, meetingLinkForRole };
