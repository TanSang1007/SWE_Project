import { request as httpsRequest } from 'node:https';
import { TextDecoder } from 'node:util';
import type { ClientRequest } from 'node:http';
import { QueryDrError } from './querydr-protocol';

export const QUERYDR_TRANSPORT = Symbol('QUERYDR_TRANSPORT');
export interface QueryDrTransport { post(fields: Readonly<Record<string, string>>): Promise<string>; }
export const SANDBOX_QUERYDR_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
// No live transport is wired until external response compatibility is verified.
export const disabledQueryDrTransport: QueryDrTransport = {
  post: () => Promise.reject(new QueryDrError('NETWORK_DISABLED')),
};

export class SandboxQueryDrHttp implements QueryDrTransport {
  constructor(private readonly send: typeof httpsRequest = httpsRequest) {}
  post(fields: Readonly<Record<string, string>>): Promise<string> {
    return new Promise((resolve, reject) => {
      let finished = false;
      const complete = (error?: QueryDrError, value?: string) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      };
      let req: ClientRequest | undefined;
      const timer = setTimeout(() => { complete(new QueryDrError('TIMEOUT')); req?.destroy(); }, 5000);
      try { req = this.send(SANDBOX_QUERYDR_URL, { method: 'POST', rejectUnauthorized: true, agent: false, maxHeaderSize: 8192,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'identity' } }, res => {
        if (res.statusCode !== 200) { complete(new QueryDrError('HTTP_FAILURE')); res.destroy(); return; }
        if (!/^application\/json(?:\s*;|$)/i.test(res.headers['content-type'] ?? '') || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
          complete(new QueryDrError('HTTP_CONTENT_TYPE')); res.destroy(); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 16384) { complete(new QueryDrError('RESPONSE_TOO_LARGE')); res.destroy(); req?.destroy(); }
          else chunks.push(chunk);
        });
        res.on('end', () => {
          try { complete(undefined, new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { complete(new QueryDrError('INVALID_UTF8')); }
        });
        res.on('error', () => complete(new QueryDrError('TRANSPORT_FAILURE')));
        res.on('aborted', () => complete(new QueryDrError('TRANSPORT_FAILURE')));
      });
      req.on('error', () => complete(new QueryDrError('TRANSPORT_FAILURE')));
      req.end(JSON.stringify(fields));
      } catch { complete(new QueryDrError('TRANSPORT_FAILURE')); req?.destroy(); }
    });
  }
}
