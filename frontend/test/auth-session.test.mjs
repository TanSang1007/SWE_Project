import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (loaded, filename) => loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { restoreSession, logoutSession } = require('../src/lib/auth-session.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const originalFetch = globalThis.fetch;
const response = role => ({ accessToken: randomUUID(), tokenType: 'Bearer', expiresIn: 3600, user: { id: randomUUID(), email: 'isolated@example.invalid', role, loyaltyPoints: 0 } });
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); });
for (const role of ['CUSTOMER', 'ADMIN', 'STAFF']) test(`${role} restores memory from same-origin session, with no token in URL/body`, async () => {
  const data = response(role); let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(url, '/api/auth/session'); assert.equal(options.credentials, 'same-origin'); assert.equal(options.headers['X-BrewLite-CSRF'], '1'); assert.equal(options.body, undefined); return Response.json(data); };
  await Promise.all([restoreSession(), restoreSession()]);
  assert.equal(calls, 1); assert.deepEqual(useAuthStore.getState().user, data.user);
});
test('expired session clears memory; unavailable session does not masquerade as logout', async () => {
  const data = response('CUSTOMER'); useAuthStore.getState().signIn(data);
  globalThis.fetch = async () => new Response('', { status: 503 }); await assert.rejects(restoreSession()); assert.equal(useAuthStore.getState().accessToken, data.accessToken);
  globalThis.fetch = async () => new Response('', { status: 401 }); await restoreSession(); assert.equal(useAuthStore.getState().user, null);
});
test('a late restoration cannot replace a more recently signed-in account', async () => {
  let complete; globalThis.fetch = () => new Promise(resolve => { complete = resolve; });
  const pending = restoreSession(), other = response('STAFF'); useAuthStore.getState().signIn(other);
  complete(Response.json(response('CUSTOMER'))); await pending; assert.equal(useAuthStore.getState().user.id, other.user.id);
});
test('logout clears memory only after server revocation succeeds', async () => {
  const data = response('ADMIN'); useAuthStore.getState().signIn(data);
  globalThis.fetch = async () => new Response('', { status: 503 }); await assert.rejects(logoutSession()); assert.equal(useAuthStore.getState().user.id, data.user.id);
  globalThis.fetch = async url => { assert.equal(url, '/api/auth/logout'); return Response.json({ loggedOut: true }); };
  await logoutSession(); assert.equal(useAuthStore.getState().user, null);
});
test('countdown anchors to backend time even when the browser wall clock differs', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
  const { PaymentCountdown } = require('../src/components/payment-countdown.tsx');
  const render = props => renderToStaticMarkup(React.createElement(PaymentCountdown, props));
  const serverNow = '2026-01-01T00:00:00Z';
  assert(render({ serverNow, expiresAt: '2026-01-01T00:10:00Z' }).includes('10:00'));
  assert(render({ serverNow, expiresAt: serverNow, verifying: true }).includes('đang xác minh'));
});
