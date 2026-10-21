import { createServer, request, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export const INGRESS_HOST = '127.0.0.1';
export const INGRESS_PORT = 3102;
export const UPSTREAM_PORT = 3001;
export const MAX_TARGET_BYTES = 8192;
export const MAX_HEADER_BYTES = 16384;
export const MAX_RESPONSE_BYTES = 65536;
export const UPSTREAM_TIMEOUT_MS = 5000;
const paths = new Set(['/payments/vnpay/ipn', '/payments/vnpay/return']);
const resultLocation = /^http:\/\/localhost:3000\/payments\/vnpay\/result(?:\?attemptId=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/i;

function reject(res: ServerResponse, status: number): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', Connection: 'close', ...(status === 405 ? { Allow: 'GET' } : {}) });
  res.end(status === 504 ? 'Callback upstream timeout.' : status === 502 ? 'Callback upstream unavailable.' : 'Callback request rejected.');
}
function rejectSocket(socket: Duplex, status: 400 | 405 | 431): void {
  if (!socket.writable) return;
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`);
}

// Options exist for isolated loopback tests only. Launcher uses fixed defaults;
// no request, env, CLI option or header can supply an upstream host/URL.
export function createCallbackIngress(options: { upstreamPort?: number; upstreamTimeoutMs?: number } = {}) {
  const port = options.upstreamPort ?? UPSTREAM_PORT, timeout = options.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeout) || timeout < 1 || timeout > UPSTREAM_TIMEOUT_MS)
    throw new Error('Invalid callback ingress configuration');
  const server = createServer({ maxHeaderSize: MAX_HEADER_BYTES, requestTimeout: 5000, headersTimeout: 5000,
    connectionsCheckingInterval: 1000, keepAliveTimeout: 1000, insecureHTTPParser: false }, (incoming, outgoing) => {
    const target = incoming.url ?? '';
    if (target.length > MAX_TARGET_BYTES) { reject(outgoing, 414); return; }
    if (!target.startsWith('/') || target.startsWith('//') || /[^\x21-\x7e]|#|\\/.test(target)) { reject(outgoing, 400); return; }
    const path = target.split('?', 1)[0];
    if (!paths.has(path)) { reject(outgoing, 404); return; }
    if (incoming.method !== 'GET') { reject(outgoing, 405); return; }
    if (incoming.headers['transfer-encoding'] !== undefined || (incoming.headers['content-length'] !== undefined && incoming.headers['content-length'] !== '0')) {
      reject(outgoing, 400); return;
    }
    // Deliberately construct fresh headers: do not forward Authorization, Cookie,
    // Host, Forwarded/X-Forwarded-*, Origin, Expect or hop-by-hop request fields.
    const upstream = request({ hostname: INGRESS_HOST, port, method: 'GET', path: target, agent: false,
      headers: { Host: `${INGRESS_HOST}:${port}`, Accept: 'application/json', Connection: 'close' }, maxHeaderSize: MAX_HEADER_BYTES });
    const timer = setTimeout(() => { reject(outgoing, 504); upstream.destroy(); }, timeout);
    const unavailable = () => { clearTimeout(timer); reject(outgoing, 502); upstream.destroy(); };
    outgoing.once('close', () => { clearTimeout(timer); upstream.destroy(); });
    incoming.once('aborted', () => { clearTimeout(timer); upstream.destroy(); });
    upstream.once('error', unavailable);
    upstream.once('upgrade', (_res, socket) => { socket.destroy(); unavailable(); });
    upstream.once('response', response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { response.destroy(); unavailable(); return; }
        chunks.push(chunk);
      });
      response.once('error', unavailable);
      response.once('end', () => {
        clearTimeout(timer);
        if (outgoing.destroyed || outgoing.writableEnded) return;
        const location = response.headers.location;
        // Preserve the backend's fixed303 verbatim, but never relay a foreign
        // redirect if an upstream misconfiguration violates C1's navigation contract.
        if (location !== undefined && (path !== '/payments/vnpay/return' || response.statusCode !== 303 || !resultLocation.test(location))) {
          unavailable(); return;
        }
        const body = Buffer.concat(chunks);
        outgoing.writeHead(response.statusCode ?? 502, {
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Connection: 'close',
          'Content-Length': body.length,
          ...(response.headers['content-type'] ? { 'Content-Type': response.headers['content-type'] } : {}),
          ...(response.headers['content-encoding'] ? { 'Content-Encoding': response.headers['content-encoding'] } : {}),
          ...(response.headers['referrer-policy'] ? { 'Referrer-Policy': response.headers['referrer-policy'] } : {}),
          ...(location ? { Location: location } : {}),
        });
        outgoing.end(body);
      });
    });
    upstream.end();
  });
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  server.on('checkContinue', (_req, res) => reject(res, 400));
  server.on('checkExpectation', (_req, res) => reject(res, 400));
  server.on('connect', (_req, socket) => rejectSocket(socket, 405));
  server.on('upgrade', (_req, socket) => rejectSocket(socket, 405));
  server.on('clientError', (error, socket) => {
    rejectSocket(socket, (error as NodeJS.ErrnoException).code === 'HPE_HEADER_OVERFLOW' ? 431 : 400);
  });
  return server;
}
