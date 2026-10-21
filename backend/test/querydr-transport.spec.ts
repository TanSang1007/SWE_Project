import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { disabledQueryDrTransport, SandboxQueryDrHttp, SANDBOX_QUERYDR_URL } from '../src/payments/vnpay/querydr-transport';
function fixture() {
  const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
  res.statusCode = 200; res.headers = { 'content-type': 'application/json' };
  const req = Object.assign(new EventEmitter(), { end: jest.fn(), destroy: jest.fn() });
  let callback: (r: IncomingMessage) => void;
  const send = jest.fn((_url: string, _opts: RequestOptions, cb: typeof callback) => { callback = cb; return req; });
  const client = new SandboxQueryDrHttp(send as unknown as typeof httpsRequest);
  const start = () => { const promise = client.post({ vnp_Command: 'querydr' }); callback(res as unknown as IncomingMessage); return promise; };
  return { res, req, send, client, start };
}
afterEach(() => jest.useRealTimers());
test('fixed Sandbox POST JSON, TLS verification, bounded header/response; no caller URL', async () => {
  const f = fixture(), result = f.start();
  expect(f.send).toHaveBeenCalledWith(SANDBOX_QUERYDR_URL, expect.objectContaining({ method: 'POST', rejectUnauthorized: true, agent: false, maxHeaderSize: 8192 }), expect.any(Function));
  expect(f.req.end).toHaveBeenCalledWith('{"vnp_Command":"querydr"}');
  f.res.end('{"ok":"yes"}'); expect(await result).toBe('{"ok":"yes"}');
});
test.each([301, 302, 307, 308, 500])('HTTP %s fails without redirect/retry', async status => {
  const f = fixture(); f.res.statusCode = status;
  await expect(f.start()).rejects.toMatchObject({ code: 'HTTP_FAILURE' }); expect(f.send).toHaveBeenCalledTimes(1);
});
test('absolute5s deadline also aborts stalled response body', async () => {
  jest.useFakeTimers(); const f = fixture(), result = f.start(); const checked = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
  f.res.write('{'); jest.advanceTimersByTime(5000); await checked; expect(f.req.destroy).toHaveBeenCalled();
});
test('connection timeout destroys request before headers', async () => {
  jest.useFakeTimers(); const f = fixture(), result = f.client.post({}); const checked = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
  jest.advanceTimersByTime(5000); await checked; expect(f.req.destroy).toHaveBeenCalled();
});
test('bounded bytes reject oversized response', async () => {
  const f = fixture(), result = f.start(); f.res.write(Buffer.alloc(16385)); await expect(result).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
});
test('invalid UTF8 rejects', async () => {
  const f = fixture(), result = f.start(); f.res.end(Buffer.from([0xc0, 0xaf])); await expect(result).rejects.toMatchObject({ code: 'INVALID_UTF8' });
});
test.each(['text/html', ''])('invalid content-type rejects %s', async value => {
  const f = fixture(); f.res.headers['content-type'] = value; await expect(f.start()).rejects.toMatchObject({ code: 'HTTP_CONTENT_TYPE' });
});
test('network error is sanitized and no automatic retry', async () => {
  const f = fixture(), result = f.client.post({}); f.req.emit('error', Error('sensitive response')); await expect(result).rejects.toMatchObject({ code: 'TRANSPORT_FAILURE', message: 'QueryDr unavailable' }); expect(f.send).toHaveBeenCalledTimes(1);
});
test('default transport has no network access', async () => { await expect(disabledQueryDrTransport.post({})).rejects.toMatchObject({ code: 'NETWORK_DISABLED' }); });
