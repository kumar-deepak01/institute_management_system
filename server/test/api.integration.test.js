const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { handleRequest } = require('../src/app');
const { projectValues, recordTable } = require('../src/services/postgresStore');

test('HTTP health and unauthenticated CSRF behavior', async t => {
  const server = http.createServer(handleRequest);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const csrf = await fetch(`${base}/api/auth/csrf`);
  assert.equal(csrf.status, 401);
  assert.equal((await csrf.json()).error, 'Sign in required.');
});

test('PostgreSQL projection maps account and admission fields to typed columns', () => {
  const account = projectValues('accounts', { id: 'a-1', email: 'user@example.com', role: 'student', passwordHash: 'hash', passwordSalt: 'salt', studentId: 's-1' });
  assert.equal(account.password_hash, 'hash');
  assert.equal(account.student_id, 's-1');
  const admission = projectValues('admissions', { id: 'APP-1', applicationNo: 'APP-1', name: 'A Student', gender: 'Other', mobile: '1234567890', email: 'a@example.com', status: 'Pending', appliedAt: '2026-01-01T00:00:00.000Z', statusHistory: [] });
  assert.equal(admission.application_no, 'APP-1');
  assert.equal(admission.status, 'Pending');
  assert.equal(recordTable('Students', { _type: 'account' }), 'accounts');
});

