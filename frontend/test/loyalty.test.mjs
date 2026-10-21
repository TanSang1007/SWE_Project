import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url); const ts = require('typescript');
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { getLoyalty, parseLoyalty } = require('../src/lib/api/loyalty.ts');
const { useAuthStore } = require('../src/lib/auth-store.ts');
const { LoyaltyContent, LoyaltyView } = require('../src/components/loyalty-view.tsx');
const { renderToStaticMarkup } = require('react-dom/server'); const React = require('react');
const originalFetch = globalThis.fetch; const originalBase = process.env.NEXT_PUBLIC_API_BASE_URL;
const signIn = (token = 'a', points = 500) => useAuthStore.getState().signIn({ accessToken: token, expiresIn: 3600, user: { id: token, email: 'fixture@example.invalid', loyaltyPoints: points, role: 'CUSTOMER' } });
const render = (state) => renderToStaticMarkup(React.createElement(LoyaltyContent, { state, retry() {} }));
beforeEach(() => { process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid'; });
afterEach(() => { globalThis.fetch = originalFetch; useAuthStore.getState().clear(); if (originalBase === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL; else process.env.NEXT_PUBLIC_API_BASE_URL = originalBase; });
test('fresh GET uses JWT/no-store, no owner/body, and server balance instead of login snapshot', async () => {
  process.env.NEXT_PUBLIC_API_BASE_URL = 'http://example.invalid'; signIn(); const calls = []; let points = 9;
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ loyaltyPoints: points }); };
  assert.equal(await getLoyalty(), 9); points = 18; assert.equal(await getLoyalty(), 18);
  assert.equal(useAuthStore.getState().user.loyaltyPoints, 500);
  assert.equal(calls.length, 2); for (const { url, options } of calls) {
    assert.equal(url, 'http://example.invalid/loyalty'); assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, 'Bearer a'); assert.equal(options.body, undefined);
  }
});
test('guest/expired auth block requests and render an accessible login link', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ loyaltyPoints: 9 }); };
  await assert.rejects(getLoyalty(), { code: 'UNAUTHORIZED' }); signIn(); useAuthStore.setState({ expiresAt: Date.now() - 1 });
  await assert.rejects(getLoyalty(), { code: 'UNAUTHORIZED' }); assert.equal(calls, 0);
  assert.match(renderToStaticMarkup(React.createElement(LoyaltyView)), /\/login\?returnTo=\/loyalty/);
});
test('401 clears current auth; delayed401/200 from previous account do not clear or reveal the new account', async () => {
  signIn(); globalThis.fetch = async () => new Response('raw internals', { status: 401 });
  await assert.rejects(getLoyalty(), { code: 'UNAUTHORIZED' }); assert.equal(useAuthStore.getState().accessToken, null);
  for (const status of [401, 200]) {
    signIn('a'); let done; globalThis.fetch = () => new Promise(resolve => { done = resolve; }); const loading = getLoyalty();
    signIn('b'); done(Response.json({ loyaltyPoints: 99 }, { status })); await assert.rejects(loading, { code: 'UNAUTHORIZED' });
    assert.equal(useAuthStore.getState().accessToken, 'b');
  }
});
test('database/network/malformed errors stay generic; a later retry reads successfully', async () => {
  signIn(); globalThis.fetch = async () => new Response('SELECT raw password_hash', { status: 503 }); await assert.rejects(getLoyalty(), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => { throw new Error('Prisma internals'); }; await assert.rejects(getLoyalty(), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => new Response('bad json'); await assert.rejects(getLoyalty(), { code: 'UNAVAILABLE' });
  globalThis.fetch = async () => Response.json({ loyaltyPoints: 0 }); assert.equal(await getLoyalty(), 0);
});
test('point response accepts exact INTEGER limits and rejects malformed amounts', () => {
  assert.equal(parseLoyalty({ loyaltyPoints: 2147483647 }), 2147483647);
  for (const value of [null, {}, { loyaltyPoints: '9' }, { loyaltyPoints: -1 }, { loyaltyPoints: 1.5 }, { loyaltyPoints: 2147483648 }]) assert.throws(() => parseLoyalty(value));
});
test('renders exactly one balance, including zero state; no order history or duplicate login points', () => {
  const html = render({ status: 'ready', points: 9 }); assert.equal((html.match(/data-loyalty-points=/g) ?? []).length, 1); assert.match(html, />9<\/strong> điểm/);
  assert.match(render({ status: 'ready', points: 0 }), /Bạn chưa có điểm tích lũy/);
  assert.match(render({ status: 'ready', points: 2147483647 }), /2\.147\.483\.647/);
});
test('loading is busy/announced and disables retry; error is announced with native Retry button', () => {
  const loading = render({ status: 'loading' }); assert.match(loading, /aria-busy="true"/); assert.match(loading, /role="status"/); assert.match(loading, /disabled/);
  const error = render({ status: 'error' }); assert.match(error, /role="alert"/); assert.match(error, /<button type="button"[^>]*>Thử lại<\/button>/); assert(!error.includes('data-loyalty-points'));
});
