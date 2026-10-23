'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { credentialsPresent, safeConfig, saveWithConnectionCheck, verifyWhatsAppSignature, recordWhatsAppMessage } = require('../src/controllers/integrationsController');
const { buildRecipients, meetingLinkForRole } = require('../src/controllers/ptmController');
const { performMeetingAction } = require('../src/services/integrationProviders');

test('provider required fields are validated without exposing values', () => {
  assert.equal(credentialsPresent('zoom',{accountId:'a',clientId:'b',clientSecret:'c',accountEmail:'d'}),true);
  assert.equal(credentialsPresent('google_meet',{authType:'service_account',serviceAccountJson:'{}',calendarId:'c',accountEmail:'a'}),true);
  assert.equal(credentialsPresent('google_meet',{authType:'oauth',clientId:'a',clientSecret:'secret',refreshToken:'token',calendarId:'c'}),false);
  const safe=safeConfig('zoom',{accountId:'acct',clientSecret:'very-secret',clientId:'id'});
  assert.deepEqual(safe,{accountId:'acct',clientId:'id'});
  const google=safeConfig('google_meet',{authType:'service_account',serviceAccountJson:'{"private_key":"never-return-this"}',calendarId:'calendar'});
  assert.deepEqual(google,{authType:'service_account',calendarId:'calendar'});
});

test('failed connection test does not persist an enabled provider', async () => {
  let persisted=false;
  await assert.rejects(saveWithConnectionCheck('zoom',{accountId:'a',clientId:'b',clientSecret:'c',accountEmail:'d'},true,async()=>{throw new Error('provider unavailable');},async()=>{persisted=true;}),/provider unavailable/);
  assert.equal(persisted,false);
  await saveWithConnectionCheck('zoom',{accountId:'a',clientId:'b',clientSecret:'c',accountEmail:'d'},false,async()=>{throw new Error('must not test while disabled');},async()=>{persisted=true;});
  assert.equal(persisted,true);
});

test('WhatsApp webhook signature checks the exact raw body and deduplicates message IDs', async () => {
  const raw=Buffer.from('{"object":"whatsapp_business_account"}'); const secret='test-secret';
  const signature=`sha256=${crypto.createHmac('sha256',secret).update(raw).digest('hex')}`;
  assert.equal(verifyWhatsAppSignature(raw,signature,secret),true);
  assert.equal(verifyWhatsAppSignature(Buffer.from('{}'),signature,secret),false);
  assert.equal(verifyWhatsAppSignature(raw,signature,''),false);
  const seen=new Set(); const insert=async id=>{if(seen.has(id))return{rowCount:0};seen.add(id);return{rowCount:1};};
  assert.equal(await recordWhatsAppMessage('wamid.1',insert),true);
  assert.equal(await recordWhatsAppMessage('wamid.1',insert),false);
});

test('PTM audience receives family notices plus the teacher, and portal links are role-scoped', async () => {
  const statements=[];
  const client={query:async(sql,params)=>{statements.push({sql,params});if(sql.startsWith('select'))return{rows:[{account_id:'parent-1',role:'parent',student_id:'student-1',staff_key:null},{account_id:'teacher-1',role:'teacher',student_id:null,staff_key:'staff-key'}],rowCount:2};return{rowCount:1};}};
  const count=await buildRecipients(client,{id:'session-1',batch_id:'batch-1',audience:'parents',teacher_staff_id:'staff-1'});
  assert.equal(count,2);
  assert.deepEqual(statements[0].params,['batch-1',['parent'],'staff-1']);
  assert.equal(statements.filter(item=>item.sql.startsWith('insert')).length,2);
  assert.equal(meetingLinkForRole('parent','scheduled','https://join','https://host'),'https://join');
  assert.equal(meetingLinkForRole('student','scheduled','https://join','https://host'),'https://join');
  assert.equal(meetingLinkForRole('teacher','scheduled','https://join','https://host'),'https://host');
  assert.equal(meetingLinkForRole('parent','cancelled','https://join','https://host'),null);
  assert.equal(meetingLinkForRole('admin','scheduled','https://join','https://host'),null);
});

test('PTM provider create, update and cancel dispatch through mocked adapters', async () => {
  const calls=[];const adapters={
    create:async(provider,details)=>{calls.push(['create',provider,details.title]);return{meetingId:'m1'};},
    update:async(provider,meeting,details)=>{calls.push(['update',provider,meeting.meetingId,details.title]);return{meetingId:meeting.meetingId};},
    delete:async(provider,meeting)=>{calls.push(['delete',provider,meeting.meetingId]);},
  };
  await performMeetingAction('create','zoom',null,{title:'PTM'},adapters);
  await performMeetingAction('update','zoom',{meetingId:'m1'},{title:'Updated PTM'},adapters);
  await performMeetingAction('delete','zoom',{meetingId:'m1'},undefined,adapters);
  assert.deepEqual(calls,[['create','zoom','PTM'],['update','zoom','m1','Updated PTM'],['delete','zoom','m1']]);
});
