import { createServer, request, type Server, type IncomingHttpHeaders } from 'node:http';
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createCallbackIngress, MAX_HEADER_BYTES, MAX_RESPONSE_BYTES, MAX_TARGET_BYTES } from '../src/callback-ingress/server';

const ipn = '/payments/vnpay/ipn', ret = '/payments/vnpay/return';
const result = 'http://localhost:3000/payments/vnpay/result';
let backend: Server, ingress: Server, port: number, backendPort: number;
let seen: { target: string; headers: IncomingHttpHeaders }[];
let status: number, body: Buffer, headers: Record<string, string>, behavior: 'reply' | 'hang' | 'truncate';
const listen = async (server: Server) => { await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok)); return (server.address() as AddressInfo).port; };
const close = async (server: Server) => { server.closeAllConnections(); await new Promise<void>(ok => server.close(() => ok())); };
beforeAll(async () => {
  backend = createServer((req, res) => {
    seen.push({ target: req.url ?? '', headers: req.headers });
    if (behavior === 'hang') return;
    if (behavior === 'truncate') { res.writeHead(200, { 'Content-Length': 100 }); res.write('partial'); res.destroy(); return; }
    res.writeHead(status, headers); res.end(body);
  });
  backendPort = await listen(backend); ingress = createCallbackIngress({ upstreamPort: backendPort, upstreamTimeoutMs: 100 }); port = await listen(ingress);
});
beforeEach(() => { seen = []; status = 200; body = Buffer.from('{"RspCode":"97","Message":"Invalid signature"}'); headers = { 'Content-Type': 'application/json; charset=utf-8' }; behavior = 'reply'; });
afterAll(async () => { await close(ingress); await close(backend); });
function call(path = ipn, method = 'GET', h: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: h, agent: false }, res => {
      const chunks: Buffer[] = []; res.on('data', (b: Buffer) => chunks.push(b));
      res.on('end', () => ok({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) })); res.on('error', fail);
    }); req.on('error', fail); req.end();
  });
}
function raw(payload: string) {
  return new Promise<string>((ok, fail) => {
    const socket = connect({ host: '127.0.0.1', port }); let received = '';
    socket.setTimeout(2000, () => socket.destroy(Error('Test socket deadline')));
    socket.on('connect', () => socket.write(payload)); socket.on('data', b => { received += b.toString(); });
    socket.on('end', () => ok(received)); socket.on('error', fail);
  });
}
test.each([ipn, ret])('only exact GET%s forwards to pinned loopback', async path => {
  const r = await call(path); expect(r.status).toBe(200); expect(seen.map(s => s.target)).toEqual([path]);
  expect(seen[0].headers.host).toBe(`127.0.0.1:${backendPort}`); expect((ingress.address() as AddressInfo).address).toBe('127.0.0.1');
});
test.each(['?a=1&b=2', '?b=2&a=1', '?vnp_OrderInfo=A+B%20C%2bD%2BD', '?vnp_OrderInfo=%C4%91%E1%BB%93+u%E1%BB%91ng',
  '?vnp_Amount=1&vnp_Amount=2&%76np_Amount=3', '?vnp_CardType=%GG', '?vnp_CardType=%C0%AF', '?vnp_SecureHash=AbCd&x=%2520', '?', '??x=1', '?x=%00'])('request target is byte-preserved %s', async query => {
  await call(ipn + query); expect(seen[0].target).toBe(ipn + query);
});
test.each(['00', '01', '02', '04', '97', '99'])('IPN ACK%s body/status/content-type preserved byte-for-byte', async code => {
  body = Buffer.from(JSON.stringify({ RspCode: code, Message: 'synthetic message ' + code }));
  const r = await call(); expect(r.status).toBe(200); expect(r.body).toEqual(body); expect(r.headers['content-type']).toBe(headers['Content-Type']); expect(r.headers['cache-control']).toBe('no-store');
});
test.each([400, 429, 500, 503])('upstream HTTP%s is never converted to success', async code => {
  status = code; const r = await call(); expect(r.status).toBe(code); expect(r.body).toEqual(body);
});
test.each([result, result + '?attemptId=11111111-1111-4111-8111-111111111111'])('Return303 preserves fixed Location%s', async location => {
  status = 303; body = Buffer.alloc(0); headers = { Location: location, 'Referrer-Policy': 'no-referrer' };
  const r = await call(ret + '?next=https%3A%2F%2Fevil.example', 'GET', { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' });
  expect(r.status).toBe(303); expect(r.headers.location).toBe(location); expect(r.body.length).toBe(0); expect(r.headers['referrer-policy']).toBe('no-referrer');
});
test.each(['https://evil.example', 'http://localhost:3000.evil.example/payments/vnpay/result', result + '?next=https://evil.example', result + '#fragment'])('upstream foreign redirect fails closed%s', async location => {
  status = 303; headers.Location = location; const r = await call(ret); expect(r.status).toBe(502); expect(r.headers.location).toBeUndefined(); expect(r.body.toString()).not.toContain('evil');
});
test.each(['/admin', '/admin/payments/vnpay/attempts/a/reconcile', '/auth/login', '/orders', '/cart', '/products', '/payments/config', '/payments/vnpay/attempts', '/health', '/', '/.env', '/prisma',
  ipn + '/', '/PAYMENTS/VNPAY/IPN', '/payments/vnpay/%69pn', '/payments/vnpay/./ipn', '/payments//vnpay/ipn'])('unlisted route%s cannot reach upstream', async path => {
  const r = await call(path); expect(r.status).toBe(404); expect(seen).toHaveLength(0);
});
test.each(['POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'])('method%s rejected before upstream', async method => {
  const r = await call(ipn, method); expect(r.status).toBe(405); expect(r.headers.allow).toBe('GET'); expect(seen).toHaveLength(0);
});
test('absolute-form URL is not an upstream selector', async () => {
  const r = await raw('GET http://evil.example:8080/payments/vnpay/ipn?secret=hidden HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
  expect(r).toMatch(/^HTTP\/1.1 400/); expect(r).not.toContain('hidden'); expect(seen).toHaveLength(0);
});
test.each(['//evil.example/payments/vnpay/ipn', ipn + '#fragment', ipn + '?x=bad\\path'])('ambiguous target%s safely rejected', async target => {
  expect((await call(target)).status).toBe(400); expect(seen).toHaveLength(0);
});
test('CONNECT and WebSocket upgrade are never forwarded', async () => {
  const c = await raw('CONNECT evil.example:443 HTTP/1.1\r\nHost: evil.example\r\n\r\n'); expect(c).toMatch(/^HTTP\/1.1 405/);
  const w = await raw('GET ' + ipn + ' HTTP/1.1\r\nHost: local\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); expect(w).toMatch(/^HTTP\/1.1 405/); expect(seen).toHaveLength(0);
});
test('framed GET/Expect rejected without forwarding a body or secret', async () => {
  const a = await raw('GET ' + ipn + ' HTTP/1.1\r\nHost: local\r\nContent-Length: 6\r\nConnection: close\r\n\r\nsecret'); expect(a).toMatch(/^HTTP\/1.1 400/); expect(a).not.toContain('secret');
  const b = await raw('GET ' + ret + ' HTTP/1.1\r\nHost: local\r\nExpect: 100-continue\r\nContent-Length: 1\r\n\r\n'); expect(b).toMatch(/^HTTP\/1.1 400/); expect(b).not.toContain('100 Continue'); expect(seen).toHaveLength(0);
});
test('ambiguous CL+TE is rejected by strict Node HTTP parser', async () => {
  const r = await raw('GET ' + ipn + ' HTTP/1.1\r\nHost: local\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n0\r\n\r\n');
  expect(r).toMatch(/^HTTP\/1.1 400/); expect(seen).toHaveLength(0);
});
test('URL and headers are bounded with safe no-store errors', async () => {
  const r = await call(ipn + '?x=' + 'x'.repeat(MAX_TARGET_BYTES)); expect(r.status).toBe(414); expect(r.body.toString().length).toBeLessThan(100); expect(seen).toHaveLength(0);
  const h = await raw('GET ' + ipn + ' HTTP/1.1\r\nHost: local\r\nX-Large: ' + 'x'.repeat(MAX_HEADER_BYTES) + '\r\n\r\n'); expect(h).toMatch(/^HTTP\/1.1 431/); expect(h).toContain('Cache-Control: no-store');
});
test('authorization/cookies/proxy headers are not forwarded; no CORS or cookies reflected', async () => {
  headers['Set-Cookie'] = 'private=cookie'; headers['Access-Control-Allow-Origin'] = '*';
  const r = await call(ipn, 'GET', { Authorization: 'Bearer synthetic-private', Cookie: 'private=synthetic', Host: 'evil.example:443',
    Origin: 'https://evil.example', Forwarded: 'for=evil;host=evil.example', 'X-Forwarded-For': '203.0.113.99', 'X-Forwarded-Proto': 'https' });
  expect(Object.keys(seen[0].headers).sort()).toEqual(['accept', 'connection', 'host']);
  expect(r.headers['set-cookie']).toBeUndefined(); expect(r.headers['access-control-allow-origin']).toBeUndefined(); expect(r.body.toString()).not.toContain('synthetic-private');
});
test('absolute upstream deadline returns504 without fabricating an ACK', async () => {
  behavior = 'hang'; const start = Date.now(), r = await call(); expect(r.status).toBe(504); expect(Date.now() - start).toBeLessThan(2000);
  expect(r.body.toString()).not.toMatch(/RspCode|00|vnp_/); expect(r.headers['cache-control']).toBe('no-store');
});
test('truncated and oversized upstream responses fail safely', async () => {
  behavior = 'truncate'; expect((await call()).status).toBe(502);
  behavior = 'reply'; body = Buffer.alloc(MAX_RESPONSE_BYTES + 1, 'x'); expect((await call()).status).toBe(502);
});
test('backend unavailable502 without success ACK or host disclosure', async () => {
  const unused = createServer(); const deadPort = await listen(unused); await close(unused);
  const isolated = createCallbackIngress({ upstreamPort: deadPort, upstreamTimeoutMs: 50 });
  const old = port; port = await listen(isolated);
  try { const r = await call(); expect(r.status).toBe(502); expect(r.body.toString()).toBe('Callback upstream unavailable.'); }
  finally { port = old; await close(isolated); }
});
test('programmatic test options cannot create arbitrary hosts or unbounded timeouts', () => {
  for (const upstreamPort of [0, -1, 65536, 1.5]) expect(() => createCallbackIngress({ upstreamPort })).toThrow();
  for (const upstreamTimeoutMs of [0, -1, 5001, 1.5]) expect(() => createCallbackIngress({ upstreamTimeoutMs })).toThrow();
});
test('callbacks and failures do not log query/JWT/headers', async () => {
  const logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];
  try { await call(ipn + '?vnp_SecureHash=synthetic-sensitive-query', 'GET', { Authorization: 'Bearer synthetic-token' }); behavior = 'hang'; await call();
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  } finally { for (const log of logs) log.mockRestore(); }
});
