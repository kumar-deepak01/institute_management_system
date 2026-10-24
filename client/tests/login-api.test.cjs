const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const services = path.join(__dirname, '..', 'src', 'services');
function loadService(filename, mocks = {}) {
  const fullPath = path.join(services, filename);
  let source = fs.readFileSync(fullPath, 'utf8').replace('import.meta.env.VITE_API_URL', '""');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = new Module(fullPath, module);
  loaded.filename = fullPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(fullPath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === fullPath && Object.hasOwn(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try { loaded._compile(output, fullPath); } finally { Module._load = originalLoad; }
  return loaded.exports;
}

const cache = { clearCurrentAccountCache() {}, loadCurrentAccount: async loader => loader() };
const api = loadService('api.ts', { './authCache': cache });
const auth = loadService('auth.ts', { './api': api, './authCache': cache });
const unavailable = 'Login service is not reachable, please try again later';

async function test(name, callback) {
  const originalFetch = global.fetch;
  try { await callback(); process.stdout.write(`ok - ${name}\n`); }
  finally { global.fetch = originalFetch; }
}

(async () => {
  await test('login submits to the single /api/auth/login endpoint', async () => {
    let request;
    global.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ ok: true, account: { role: 'admin' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await auth.login('admin@example.test', 'example-password');
    assert.equal(request.url, '/api/auth/login');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.credentials, 'include');
  });

  await test('login gives a service message for a non-JSON 404 and keeps invalid credentials clear', async () => {
    global.fetch = async () => new Response('<html>Not Found</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    await assert.rejects(auth.login('admin@example.test', 'example-password'), error => error.message === unavailable && error.status === 404);

    global.fetch = async () => new Response('<html>Unexpected response</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    await assert.rejects(auth.login('admin@example.test', 'example-password'), error => error.message === unavailable && error.status === 200);

    global.fetch = async () => new Response(JSON.stringify({ error: 'Email or password is incorrect.' }), { status: 401, headers: { 'content-type': 'application/json' } });
    await assert.rejects(auth.login('admin@example.test', 'wrong-password'), error => error.message === 'Invalid email or password' && error.status === 401);
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
