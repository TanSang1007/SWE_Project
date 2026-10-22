import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const ts = require('typescript');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { validateCredentials, safeReturnTo } = require('../src/lib/auth-validation.ts');
const api = require('../src/lib/api/auth.ts');
const { useAuthStore, getAccessToken } = require('../src/lib/auth-store.ts');
const originalFetch = globalThis.fetch;
const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
const credentials = { email: `${randomUUID()}@example.invalid`, password: ` ${randomBytes(18).toString('hex')} ` };
const user = { id: randomUUID(), email: credentials.email, loyaltyPoints: 0, role: 'CUSTOMER' };
const token = randomBytes(32).toString('base64url');
const response = { accessToken: token, tokenType: 'Bearer', expiresIn: 3600, user };
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL; else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase; });
test('form validation checks email and UTF-8 bytes without trimming passwords', () => {
  assert.equal(validateCredentials(credentials), null);
  assert(validateCredentials({ ...credentials, email: 'invalid' }));
  assert(validateCredentials({ ...credentials, password: 'x'.repeat(7) }));
  assert(validateCredentials({ ...credentials, password: 'é'.repeat(37) }));
  assert.equal(validateCredentials({ ...credentials, password: 'é'.repeat(36) }), null);
});
test('return path blocks external redirects and auth loops', () => {
  for (const value of ['https://example.invalid', '//example.invalid', '/\\example.invalid', '/login?returnTo=/register', null]) assert.equal(safeReturnTo(value), '/');
  assert.equal(safeReturnTo('/products/abc'), '/products/abc');
});
test('successful login parses only public user fields and writes memory state', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
  let requested;
  globalThis.fetch = async (url, options) => { requested = { url, options }; return new Response(JSON.stringify({ ...response, user: { ...user, passwordHash: 'discarded' } })); };
  const result = await api.login(credentials); assert.deepEqual(result, response);
  assert.equal(requested.url, '/api/auth/login'); assert.equal(requested.options.method, 'POST');
  assert.equal(requested.options.credentials, 'same-origin'); assert.equal(requested.options.headers['X-BrewLite-CSRF'], '1');
  assert.equal(JSON.parse(requested.options.body).password, credentials.password);
  useAuthStore.getState().signIn(result); assert.equal(getAccessToken(), token); assert.deepEqual(useAuthStore.getState().user, user);
  useAuthStore.getState().clear(); assert.equal(getAccessToken(), null);
});
test('registration does not sign in automatically', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
  globalThis.fetch = async () => new Response(JSON.stringify({ user }), { status: 201 });
  assert.deepEqual(await api.register(credentials), { user }); assert.equal(getAccessToken(), null);
});
test('memory state expires and does not use persistence', () => {
  useAuthStore.getState().signIn(response); useAuthStore.setState({ expiresAt: Date.now() - 1 });
  assert.equal(getAccessToken(), null); assert.equal(useAuthStore.getState().user, null);
  assert(!readFileSync(new URL('../src/lib/auth-store.ts', import.meta.url), 'utf8').includes('persist('));
});
for (const [status, code] of [[400, 'VALIDATION_ERROR'], [401, 'INVALID_CREDENTIALS'], [409, 'EMAIL_ALREADY_EXISTS'], [500, 'UNAVAILABLE']]) {
  test(`HTTP ${status} maps to safe auth message`, async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid';
    globalThis.fetch = async () => new Response('SQL raw stack', { status });
    await assert.rejects(api.login(credentials), (error) => error.code === code && !api.authErrorMessage(code).includes('SQL'));
  });
}
test('client rejects malformed token/lifetime and sanitizes network errors', async () => {
  assert.throws(() => api.parseLogin({ ...response, expiresIn: 7200 }));
  assert.throws(() => api.parseLogin({ ...response, accessToken: null }));
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid'; globalThis.fetch = async () => { throw new Error('network internals'); };
  await assert.rejects(api.login(credentials), { code: 'UNAVAILABLE' });
});
